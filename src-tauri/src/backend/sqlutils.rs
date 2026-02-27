use crate::backend::models::DbType;
use sqlparser::ast::Statement;
use sqlparser::dialect::{
    GenericDialect, MsSqlDialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;

pub fn format_sql(sql: &str, db_type: DbType) -> Result<String, String> {
    let dialect = select_dialect(db_type);
    let statements = Parser::parse_sql(&*dialect, sql).map_err(|e| e.to_string())?;
    if statements.is_empty() {
        return Err("No SQL statements".to_string());
    }
    Ok(statements[0].to_string())
}

pub fn extract_view_select(ddl: &str, db_type: DbType) -> Result<Option<String>, String> {
    let dialect = select_dialect(db_type);
    let statements = Parser::parse_sql(&*dialect, ddl).map_err(|e| e.to_string())?;
    for stmt in statements {
        if let Statement::CreateView { query, .. } = stmt {
            return Ok(Some(query.to_string()));
        }
    }
    Ok(None)
}

pub fn split_sql_statements(sql: &str, db_type: DbType) -> Vec<String> {
    let db_type = match db_type {
        DbType::Mysql => "MYSQL",
        DbType::PostgreSql => "POSTGRESQL",
        DbType::Sqlite => "SQLITE",
        DbType::SqlServer => "SQL_SERVER",
        DbType::Oracle => "ORACLE",
    };
    split_sql_statements_inner(sql, db_type)
}

fn select_dialect(db_type: DbType) -> Box<dyn sqlparser::dialect::Dialect> {
    match db_type {
        DbType::Mysql => Box::new(MySqlDialect {}),
        DbType::PostgreSql => Box::new(PostgreSqlDialect {}),
        DbType::Sqlite => Box::new(SQLiteDialect {}),
        DbType::SqlServer => Box::new(MsSqlDialect {}),
        DbType::Oracle => Box::new(GenericDialect {}),
    }
}

fn split_sql_statements_inner(sql: &str, db_type: &str) -> Vec<String> {
    let mut statements = Vec::new();
    if sql.trim().is_empty() {
        return statements;
    }

    let mut current = String::new();
    let mut delimiter = ";".to_string();
    let mut in_string = false;
    let mut string_char = '\0';
    let mut in_block_comment = false;
    let mut in_line_comment = false;
    let mut block_depth: i32 = 0;
    let mut current_word = String::new();

    let support_go = db_type.eq_ignore_ascii_case("SQL_SERVER");
    let support_slash = db_type.eq_ignore_ascii_case("ORACLE");
    let support_delimiter_cmd = db_type.eq_ignore_ascii_case("MYSQL");

    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        let next_ch = if i + 1 < chars.len() {
            chars[i + 1]
        } else {
            '\0'
        };

        if !in_block_comment && !in_line_comment && !in_string {
            if ch == '\'' || ch == '"' || ch == '`' {
                in_string = true;
                string_char = ch;
            } else if ch == '-' && next_ch == '-' {
                in_line_comment = true;
            } else if ch == '/' && next_ch == '*' {
                in_block_comment = true;
            } else if ch == '#' && support_delimiter_cmd {
                in_line_comment = true;
            }
        } else if in_string {
            if ch == string_char {
                let mut escaped = false;
                let mut j = i as i32 - 1;
                while j >= 0 {
                    if chars[j as usize] == '\\' {
                        escaped = !escaped;
                        j -= 1;
                    } else {
                        break;
                    }
                }
                if !escaped {
                    if ch == '\'' && next_ch == '\'' {
                        current.push(ch);
                        i += 1;
                    } else {
                        in_string = false;
                    }
                }
            }
        } else if in_block_comment {
            if ch == '*' && next_ch == '/' {
                in_block_comment = false;
                current.push(ch);
                current.push(next_ch);
                i += 1;
                i += 1;
                continue;
            }
        } else if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
        }

        if !in_string && !in_block_comment && !in_line_comment {
            if support_delimiter_cmd && line_starts_with(&chars, i, "DELIMITER") {
                let line_end = find_line_end(&chars, i);
                let line = chars[i..line_end].iter().collect::<String>();
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    delimiter = parts[1].to_string();
                    current.clear();
                    i = if line_end == 0 { 0 } else { line_end - 1 };
                    i += 1;
                    continue;
                }
            }

            if support_go && line_equals(&chars, i, "GO") {
                let stmt = current.trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                    current.clear();
                }
                i += 2;
                continue;
            }

            if support_slash && line_equals(&chars, i, "/") {
                let stmt = current.trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                    current.clear();
                }
                i += 1;
                continue;
            }

            if ch.is_alphanumeric() || ch == '_' {
                current_word.push(ch);
            } else if !current_word.is_empty() {
                let word = current_word.to_ascii_uppercase();
                current_word.clear();
                if word == "BEGIN" || word == "CASE" {
                    block_depth += 1;
                } else if word == "END" {
                    if block_depth > 0 {
                        block_depth -= 1;
                    }
                }
            }

            if matches_delimiter(&chars, i, &delimiter) {
                if block_depth <= 0 {
                    let stmt = current.trim();
                    if !stmt.is_empty() {
                        statements.push(stmt.to_string());
                    }
                    current.clear();
                    block_depth = 0;
                    i += delimiter.len();
                    continue;
                }
            }
        }

        current.push(ch);
        i += 1;
    }

    let last = current.trim();
    if !last.is_empty() && !last.to_ascii_lowercase().starts_with("delimiter") {
        statements.push(last.to_string());
    }

    statements
}

fn find_line_end(chars: &[char], start: usize) -> usize {
    let mut i = start;
    while i < chars.len() {
        if chars[i] == '\n' {
            return i;
        }
        i += 1;
    }
    chars.len()
}

fn line_starts_with(chars: &[char], index: usize, keyword: &str) -> bool {
    if !is_line_prefix_whitespace(chars, index) {
        return false;
    }
    let end = index + keyword.len();
    if end > chars.len() {
        return false;
    }
    let slice = chars[index..end].iter().collect::<String>();
    slice.eq_ignore_ascii_case(keyword)
}

fn line_equals(chars: &[char], index: usize, keyword: &str) -> bool {
    if !is_line_prefix_whitespace(chars, index) {
        return false;
    }
    let end = index + keyword.len();
    if end > chars.len() {
        return false;
    }
    let slice = chars[index..end].iter().collect::<String>();
    if !slice.eq_ignore_ascii_case(keyword) {
        return false;
    }
    if end >= chars.len() {
        return true;
    }
    let mut i = end;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '\n' || ch == '\r' {
            return true;
        }
        if !ch.is_whitespace() {
            return false;
        }
        i += 1;
    }
    true
}

fn is_line_prefix_whitespace(chars: &[char], index: usize) -> bool {
    if index == 0 {
        return true;
    }
    let mut i = index;
    while i > 0 {
        let prev = chars[i - 1];
        if prev == '\n' {
            return true;
        }
        if !prev.is_whitespace() {
            return false;
        }
        i -= 1;
    }
    true
}

fn matches_delimiter(chars: &[char], index: usize, delimiter: &str) -> bool {
    let len = delimiter.chars().count();
    if index + len > chars.len() {
        return false;
    }
    let slice = chars[index..index + len].iter().collect::<String>();
    slice == delimiter
}
