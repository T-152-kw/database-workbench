import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Checkbox, HTMLSelect, Spinner } from '@blueprintjs/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import SongtiSCBlack from 'jspdf-font/fonts/SongtiSCBlack.js';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  HeadingLevel,
  InternalHyperlink,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type {
  ConnectionProfile,
  FunctionDetail,
  MetadataRecord,
  RoutineParamInfo,
  TableDetail,
  ViewDetail,
} from '../../types';
import { metadataApi } from '../../hooks/useTauri';
import '../../styles/data-dictionary-tab.css';

interface DataDictionaryTabProps {
  tabId: string;
  connectionProfile: ConnectionProfile;
  database: string;
}

interface TableDictionaryItem {
  detail: TableDetail;
  columns: MetadataRecord[];
  indexes: MetadataRecord[];
  foreignKeys: MetadataRecord[];
  checks: MetadataRecord[];
  triggers: MetadataRecord[];
}

interface RoutineDictionaryItem {
  detail: FunctionDetail;
  params: RoutineParamInfo[];
  ddl?: string;
}

interface DictionaryDocument {
  generatedAt: string;
  connectionName: string;
  host: string;
  database: string;
  tables: TableDictionaryItem[];
  views: ViewDetail[];
  routines: RoutineDictionaryItem[];
}

interface ObjectCatalog {
  tables: TableDetail[];
  views: ViewDetail[];
  routines: FunctionDetail[];
}

type ExportFormat = 'pdf' | 'docx' | 'html' | 'markdown' | 'json';

const PREVIEW_STYLE = `
  .dd-doc { font-family: Inter, Segoe UI, Arial, sans-serif; color: #0f172a; background: #fff; }
  .dd-cover { border-radius: 14px; background: linear-gradient(135deg, #eff6ff, #ffffff); border: 1px solid #dbeafe; padding: 34px 30px; margin-bottom: 22px; }
  .dd-cover h1 { margin: 0; font-size: 36px; line-height: 1.2; color: #1d4ed8; }
  .dd-cover h2 { margin: 8px 0 0; font-size: 22px; color: #1e293b; font-weight: 600; }
  .dd-cover-meta { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; font-size: 13px; color: #334155; }
  .dd-cover-meta .label { color: #64748b; margin-right: 6px; }
  .dd-section { margin-bottom: 22px; }
  .dd-section-title { font-size: 21px; margin: 0 0 10px; color: #0f172a; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }
  .dd-card { border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
  .dd-card h4 { margin: 0 0 10px; font-size: 17px; color: #1e293b; }
  .dd-key-value { display: grid; grid-template-columns: 190px 1fr; gap: 6px 10px; font-size: 12px; margin: 8px 0 12px; }
  .dd-key-value .k { color: #64748b; }
  .dd-key-value .v { color: #1e293b; word-break: break-word; }
  .dd-subtitle { margin: 12px 0 8px; color: #475569; font-size: 13px; font-weight: 600; }
  .dd-table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .dd-table th, .dd-table td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; }
  .dd-table th { background: #f8fafc; color: #334155; }
  .dd-empty { color: #94a3b8; font-size: 12px; }
  .dd-toc ol { margin: 8px 0 0; padding-left: 20px; color: #334155; font-size: 13px; }
  .dd-toc li { margin: 3px 0; }
  .dd-anchor { color: #1d4ed8; text-decoration: none; }
  .dd-anchor:hover { text-decoration: underline; }
`;

const valueOrDash = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const fixMojibakeIfNeeded = (value: string): string => {
  const suspicious = /[ÃÂâ€¢†‡‰‹›™œžŸ�•ƒ]/.test(value);
  if (!suspicious) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const score = (text: string): number => (text.match(/[ÃÂâ€¢†‡‰‹›™œžŸ�•ƒ]/g) || []).length;
    return decoded && score(decoded) < score(value) ? decoded : value;
  } catch {
    return value;
  }
};

const normalizePdfText = (value: unknown): string => {
  const raw = valueOrDash(value);
  const repaired = fixMojibakeIfNeeded(raw);
  const cleaned = repaired
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return cleaned.trim() || '-';
};

const getRecordKeys = (records: MetadataRecord[]): string[] =>
  Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

const renderRecordTableHtml = (records: MetadataRecord[]): string => {
  if (records.length === 0) {
    return '<div class="dd-empty">-</div>';
  }
  const keys = getRecordKeys(records);
  const head = `<tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join('')}</tr>`;
  const body = records
    .map(
      (record) =>
        `<tr>${keys
          .map((key) => `<td>${escapeHtml(valueOrDash(record[key]))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table class="dd-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
};

const renderKeyValueHtml = (record: Record<string, unknown>): string => {
  const rows = Object.entries(record)
    .map(
      ([key, value]) =>
        `<div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(valueOrDash(value))}</div>`,
    )
    .join('');
  return `<div class="dd-key-value">${rows}</div>`;
};

const buildHtmlBody = (doc: DictionaryDocument): string => {
  const tocTableItems = doc.tables
    .map((table, index) => `<li><a class="dd-anchor" href="#table-${index + 1}">${escapeHtml(table.detail.Name)}</a></li>`)
    .join('');
  const tocViewItems = doc.views
    .map((view, index) => `<li><a class="dd-anchor" href="#view-${index + 1}">${escapeHtml(view.Name)}</a></li>`)
    .join('');
  const tocRoutineItems = doc.routines
    .map(
      (routine, index) =>
        `<li><a class="dd-anchor" href="#routine-${index + 1}">${escapeHtml(routine.detail.Name)} (${escapeHtml(routine.detail.Type)})</a></li>`,
    )
    .join('');

  const tablesHtml = doc.tables
    .map(
      (table, index) => `
        <article class="dd-card" id="table-${index + 1}">
          <h4>${escapeHtml(table.detail.Name)}</h4>
          ${renderKeyValueHtml(table.detail as unknown as Record<string, unknown>)}
          <div class="dd-subtitle">Columns</div>
          ${renderRecordTableHtml(table.columns)}
          <div class="dd-subtitle">Indexes</div>
          ${renderRecordTableHtml(table.indexes)}
          <div class="dd-subtitle">Foreign Keys</div>
          ${renderRecordTableHtml(table.foreignKeys)}
          <div class="dd-subtitle">Checks</div>
          ${renderRecordTableHtml(table.checks)}
          <div class="dd-subtitle">Triggers</div>
          ${renderRecordTableHtml(table.triggers)}
        </article>
      `,
    )
    .join('');

  const viewsHtml = doc.views
    .map(
      (view, index) => `
        <article class="dd-card" id="view-${index + 1}">
          <h4>${escapeHtml(view.Name)}</h4>
          ${renderKeyValueHtml(view as unknown as Record<string, unknown>)}
        </article>
      `,
    )
    .join('');

  const routinesHtml = doc.routines
    .map((routine, index) => {
      const paramsTable =
        routine.params.length > 0
          ? renderRecordTableHtml(
              routine.params.map((param) => ({
                MODE: param.mode || '',
                NAME: param.name,
                TYPE: param.type,
              })),
            )
          : '<div class="dd-empty">-</div>';

      const ddlBlock = routine.ddl
        ? `<div class="dd-subtitle">DDL</div><pre>${escapeHtml(routine.ddl)}</pre>`
        : '';

      return `
        <article class="dd-card" id="routine-${index + 1}">
          <h4>${escapeHtml(routine.detail.Name)} (${escapeHtml(routine.detail.Type)})</h4>
          ${renderKeyValueHtml(routine.detail as unknown as Record<string, unknown>)}
          <div class="dd-subtitle">Params</div>
          ${paramsTable}
          ${ddlBlock}
        </article>
      `;
    })
    .join('');

  return `
    <div class="dd-doc">
      <section class="dd-cover">
        <h1>Data Dictionary</h1>
        <h2>${escapeHtml(doc.database)}</h2>
        <div class="dd-cover-meta">
          <div><span class="label">Generated At:</span>${escapeHtml(doc.generatedAt)}</div>
          <div><span class="label">Connection:</span>${escapeHtml(doc.connectionName)}</div>
          <div><span class="label">Host:</span>${escapeHtml(doc.host)}</div>
          <div><span class="label">Database:</span>${escapeHtml(doc.database)}</div>
          <div><span class="label">Tables:</span>${doc.tables.length}</div>
          <div><span class="label">Views:</span>${doc.views.length}</div>
          <div><span class="label">Routines:</span>${doc.routines.length}</div>
        </div>
      </section>

      <section class="dd-section dd-toc">
        <h3 class="dd-section-title">Table of Contents</h3>
        <ol>
          <li><a class="dd-anchor" href="#overview">Overview</a></li>
          <li>
            <a class="dd-anchor" href="#tables">Tables</a>
            <ol>${tocTableItems || '<li>-</li>'}</ol>
          </li>
          <li>
            <a class="dd-anchor" href="#views">Views</a>
            <ol>${tocViewItems || '<li>-</li>'}</ol>
          </li>
          <li>
            <a class="dd-anchor" href="#routines">Routines</a>
            <ol>${tocRoutineItems || '<li>-</li>'}</ol>
          </li>
        </ol>
      </section>

      <section class="dd-section" id="overview">
        <h3 class="dd-section-title">Overview</h3>
        <article class="dd-card">
          ${renderKeyValueHtml({
            GeneratedAt: doc.generatedAt,
            Connection: doc.connectionName,
            Host: doc.host,
            Database: doc.database,
            TableCount: doc.tables.length,
            ViewCount: doc.views.length,
            RoutineCount: doc.routines.length,
          })}
        </article>
      </section>

      <section class="dd-section" id="tables">
        <h3 class="dd-section-title">Tables</h3>
        ${tablesHtml || '<div class="dd-empty">-</div>'}
      </section>

      <section class="dd-section" id="views">
        <h3 class="dd-section-title">Views</h3>
        ${viewsHtml || '<div class="dd-empty">-</div>'}
      </section>

      <section class="dd-section" id="routines">
        <h3 class="dd-section-title">Routines</h3>
        ${routinesHtml || '<div class="dd-empty">-</div>'}
      </section>
    </div>
  `;
};

const buildHtmlDocument = (doc: DictionaryDocument): string => {
  const body = buildHtmlBody(doc);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Data Dictionary - ${escapeHtml(doc.database)}</title>
  <style>${PREVIEW_STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
};

const escapeMarkdownInline = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|');

const normalizeMarkdownValue = (value: unknown): string =>
  String(valueOrDash(value)).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() || '-';

const toMarkdownTableCell = (value: unknown): string =>
  escapeMarkdownInline(normalizeMarkdownValue(value)).replace(/\n/g, '<br/>');

const toMarkdownCodeBlock = (value: unknown, language = 'sql'): string => {
  const text = normalizeMarkdownValue(value);
  if (text === '-') {
    return '-';
  }
  const safe = text.replace(/```/g, '``\\`');
  return `\n\`\`\`${language}\n${safe}\n\`\`\``;
};

const renderMarkdownRecordTable = (records: MetadataRecord[]): string[] => {
  if (records.length === 0) {
    return ['-'];
  }

  const keys = getRecordKeys(records);
  const header = `| ${keys.map((key) => toMarkdownTableCell(key)).join(' | ')} |`;
  const separator = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = records.map((record) => `| ${keys.map((key) => toMarkdownTableCell(record[key])).join(' | ')} |`);

  return [header, separator, ...body];
};

const renderMarkdownKeyValueTable = (record: Record<string, unknown>): string[] => {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return ['| Key | Value |', '| --- | --- |', '| - | - |'];
  }

  const rows = entries.map(([key, value]) => `| ${toMarkdownTableCell(key)} | ${toMarkdownTableCell(value)} |`);
  return ['| Key | Value |', '| --- | --- |', ...rows];
};

const buildMarkdown = (doc: DictionaryDocument): string => {
  const anchor = (id: string): string => `<a id="${id}"></a>`;
  const link = (label: string, id: string): string => `[${label}](#${id})`;
  const safe = (value: unknown): string => escapeMarkdownInline(normalizeMarkdownValue(value));

  const overviewId = 'overview';
  const tocId = 'table-of-contents';
  const tablesId = 'tables';
  const viewsId = 'views';
  const routinesId = 'routines';

  const tableId = (index: number): string => `table-${index + 1}`;
  const viewId = (index: number): string => `view-${index + 1}`;
  const routineId = (index: number): string => `routine-${index + 1}`;

  const lines: string[] = [];
  lines.push(anchor('top'));
  lines.push(`# Data Dictionary`);
  lines.push('');
  lines.push(`## ${safe(doc.database)}`);
  lines.push('');
  lines.push('> Generated by Database Workbench');
  lines.push('');

  lines.push(anchor(overviewId));
  lines.push('## Overview');
  lines.push('');
  lines.push(...renderMarkdownKeyValueTable({
    GeneratedAt: doc.generatedAt,
    Connection: doc.connectionName,
    Host: doc.host,
    Database: doc.database,
    Tables: doc.tables.length,
    Views: doc.views.length,
    Routines: doc.routines.length,
  }));
  lines.push('');

  lines.push(anchor(tocId));
  lines.push('## Table of Contents');
  lines.push(`- ${link('Overview', overviewId)}`);
  lines.push(`- ${link('Tables', tablesId)}`);
  doc.tables.forEach((table, index) =>
    lines.push(`  - ${index + 1}. ${link(safe(table.detail.Name), tableId(index))}`),
  );
  lines.push(`- ${link('Views', viewsId)}`);
  doc.views.forEach((view, index) =>
    lines.push(`  - ${index + 1}. ${link(safe(view.Name), viewId(index))}`),
  );
  lines.push(`- ${link('Routines', routinesId)}`);
  doc.routines.forEach((routine, index) =>
    lines.push(
      `  - ${index + 1}. ${link(`${safe(routine.detail.Name)} (${safe(routine.detail.Type)})`, routineId(index))}`,
    ),
  );
  lines.push('');

  lines.push(anchor(tablesId));
  lines.push('## Tables');
  lines.push('');
  lines.push(`[↑ Back to Table of Contents](#${tocId})`);
  lines.push('');
  if (doc.tables.length === 0) {
    lines.push('-');
    lines.push('');
  } else {
    doc.tables.forEach((table, index) => {
      lines.push(anchor(tableId(index)));
      lines.push(`### ${index + 1}. ${safe(table.detail.Name)}`);
      lines.push('');
      lines.push('#### Properties');
      lines.push('');
      lines.push(...renderMarkdownKeyValueTable(table.detail as unknown as Record<string, unknown>));
      lines.push('');

      lines.push('#### Columns');
      lines.push('');
      lines.push(...renderMarkdownRecordTable(table.columns));
      lines.push('');

      lines.push('#### Indexes');
      lines.push('');
      lines.push(...renderMarkdownRecordTable(table.indexes));
      lines.push('');

      lines.push('#### Foreign Keys');
      lines.push('');
      lines.push(...renderMarkdownRecordTable(table.foreignKeys));
      lines.push('');

      lines.push('#### Checks');
      lines.push('');
      lines.push(...renderMarkdownRecordTable(table.checks));
      lines.push('');

      lines.push('#### Triggers');
      lines.push('');
      lines.push(...renderMarkdownRecordTable(table.triggers));
      lines.push('');
      lines.push(`[↑ Back to Tables](#${tablesId}) · [↑ Back to TOC](#${tocId})`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
  }

  lines.push(anchor(viewsId));
  lines.push('## Views');
  lines.push('');
  lines.push(`[↑ Back to Table of Contents](#${tocId})`);
  lines.push('');
  if (doc.views.length === 0) {
    lines.push('-');
    lines.push('');
  } else {
    doc.views.forEach((view, index) => {
      lines.push(anchor(viewId(index)));
      lines.push(`### ${index + 1}. ${safe(view.Name)}`);
      lines.push('');
      lines.push('#### Properties');
      lines.push('');
      lines.push(...renderMarkdownKeyValueTable(view as unknown as Record<string, unknown>));
      lines.push('');

      if (view.Definition) {
        lines.push('#### Definition');
        lines.push(toMarkdownCodeBlock(view.Definition, 'sql'));
        lines.push('');
      }

      lines.push(`[↑ Back to Views](#${viewsId}) · [↑ Back to TOC](#${tocId})`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
  }

  lines.push(anchor(routinesId));
  lines.push('## Routines');
  lines.push('');
  lines.push(`[↑ Back to Table of Contents](#${tocId})`);
  lines.push('');
  if (doc.routines.length === 0) {
    lines.push('-');
    lines.push('');
  } else {
    doc.routines.forEach((routine, index) => {
      lines.push(anchor(routineId(index)));
      lines.push(
        `### ${index + 1}. ${safe(routine.detail.Name)} (${safe(routine.detail.Type)})`,
      );
      lines.push('');
      lines.push('#### Properties');
      lines.push('');
      lines.push(...renderMarkdownKeyValueTable(routine.detail as unknown as Record<string, unknown>));
      lines.push('');

      lines.push('#### Params');
      lines.push('');
      const paramRecords = routine.params.map((param) => ({
        MODE: param.mode || '',
        NAME: param.name,
        TYPE: param.type,
      }));
      lines.push(...renderMarkdownRecordTable(paramRecords));
      lines.push('');

      if (routine.detail.Definition) {
        lines.push('#### Definition');
        lines.push(toMarkdownCodeBlock(routine.detail.Definition, 'sql'));
        lines.push('');
      }

      if (routine.ddl) {
        lines.push('#### DDL');
        lines.push(toMarkdownCodeBlock(routine.ddl, 'sql'));
        lines.push('');
      }

      lines.push(`[↑ Back to Routines](#${routinesId}) · [↑ Back to TOC](#${tocId})`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
  }

  return lines.join('\n');
};

const DOCX_BORDER_COLOR = 'E2E8F0';
const DOCX_HEADER_FILL = 'F8FAFC';
const DOCX_COVER_FILL = 'EFF6FF';

const toDocxAnchorId = (prefix: string, value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}-${normalized || 'item'}`;
};

const createDocxLinkLine = (text: string, anchor: string, indentTwip = 0): Paragraph =>
  new Paragraph({
    indent: indentTwip > 0 ? { left: indentTwip } : undefined,
    spacing: { after: 40 },
    children: [
      new InternalHyperlink({
        anchor,
        children: [
          new TextRun({
            text,
            color: '1D4ED8',
            underline: { color: '1D4ED8', type: 'single' },
          }),
        ],
      }),
    ],
  });

const docxText = (value: unknown): string =>
  String(valueOrDash(value)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const createDocxSectionTitle = (text: string, pageBreakBefore = false, anchorId?: string): Paragraph =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore,
    spacing: { before: 300, after: 140 },
    children: [
      new Bookmark({
        id: anchorId || toDocxAnchorId('section', text),
        children: [new TextRun({ text })],
      }),
    ],
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: DOCX_BORDER_COLOR,
      },
    },
  });

const createDocxSubTitle = (text: string): Paragraph =>
  new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 90 },
  });

const createDocxKeyValueTable = (record: Record<string, unknown>): Table => {
  const rows = Object.entries(record).map(
    ([key, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 34, type: WidthType.PERCENTAGE },
            shading: { fill: DOCX_HEADER_FILL },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: docxText(key), bold: true, color: '334155' })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 66, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: docxText(value)
              .split('\n')
              .map((line) => new Paragraph({ text: line || ' ', spacing: { after: 0, before: 0 } })),
          }),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
    },
  });
};

const createDocxRecordTable = (records: MetadataRecord[]): Table | Paragraph => {
  if (records.length === 0) {
    return new Paragraph({ text: '-', spacing: { after: 120 } });
  }

  const keys = getRecordKeys(records);
  const header = new TableRow({
    children: keys.map(
      (key) =>
        new TableCell({
          shading: { fill: DOCX_HEADER_FILL },
          margins: { top: 100, bottom: 100, left: 80, right: 80 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: docxText(key), bold: true, color: '334155' })],
            }),
          ],
        }),
    ),
  });

  const body = records.map(
    (record) =>
      new TableRow({
        children: keys.map(
          (key) =>
            new TableCell({
              margins: { top: 80, bottom: 80, left: 80, right: 80 },
              children: docxText(record[key])
                .split('\n')
                .map((line) => new Paragraph({ text: line || ' ', spacing: { after: 0, before: 0 } })),
            }),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...body],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
    },
  });
};

const createDocxCodeBlock = (text: string): Table => {
  const lines = docxText(text).split('\n');
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: DOCX_HEADER_FILL },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: lines.map(
              (line) =>
                new Paragraph({
                  children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: '1E293B' })],
                  spacing: { before: 0, after: 0 },
                }),
            ),
          }),
        ],
      }),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: DOCX_BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: DOCX_BORDER_COLOR },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: DOCX_BORDER_COLOR },
    },
  });
};

const createDocxCover = (doc: DictionaryDocument): Table => {
  const summary = [
    ['Generated At', doc.generatedAt],
    ['Connection', doc.connectionName],
    ['Host', doc.host],
    ['Database', doc.database],
    ['Tables', doc.tables.length],
    ['Views', doc.views.length],
    ['Routines', doc.routines.length],
  ];

  const summaryRows = summary.map(
    ([key, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: `${key}:`, color: '64748B', bold: true })] })],
          }),
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph(docxText(value))],
          }),
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph('')],
          }),
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph('')],
          }),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 4,
            shading: { fill: DOCX_COVER_FILL },
            margins: { top: 260, bottom: 120, left: 240, right: 240 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: 'Data Dictionary', bold: true, color: '1D4ED8', size: 56 })],
                alignment: AlignmentType.LEFT,
                spacing: { after: 120 },
              }),
              new Paragraph({
                children: [new TextRun({ text: docxText(doc.database), bold: true, color: '1E293B', size: 34 })],
                spacing: { after: 120 },
              }),
            ],
          }),
        ],
      }),
      ...summaryRows,
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: 'DBEAFE' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: 'DBEAFE' },
      left: { style: BorderStyle.SINGLE, size: 8, color: 'DBEAFE' },
      right: { style: BorderStyle.SINGLE, size: 8, color: 'DBEAFE' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: DOCX_BORDER_COLOR },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: DOCX_BORDER_COLOR },
    },
  });
};

const buildDocxBytes = async (doc: DictionaryDocument): Promise<Uint8Array> => {
  const children: (Paragraph | Table)[] = [];

  const overviewAnchor = 'overview';
  const tablesAnchor = 'tables';
  const viewsAnchor = 'views';
  const routinesAnchor = 'routines';

  const tableAnchors = doc.tables.map((table, index) => toDocxAnchorId('table', `${index + 1}-${docxText(table.detail.Name)}`));
  const viewAnchors = doc.views.map((view, index) => toDocxAnchorId('view', `${index + 1}-${docxText(view.Name)}`));
  const routineAnchors = doc.routines.map((routine, index) =>
    toDocxAnchorId('routine', `${index + 1}-${docxText(routine.detail.Name)}-${docxText(routine.detail.Type)}`),
  );

  children.push(createDocxCover(doc));
  children.push(new Paragraph({ text: '', spacing: { after: 120 } }));

  children.push(createDocxSectionTitle('Table of Contents'));
  children.push(createDocxLinkLine('1. Overview', overviewAnchor));
  children.push(createDocxLinkLine('2. Tables', tablesAnchor));
  doc.tables.forEach((table, index) =>
    children.push(createDocxLinkLine(`2.${index + 1} ${docxText(table.detail.Name)}`, tableAnchors[index], 360)),
  );
  children.push(createDocxLinkLine('3. Views', viewsAnchor));
  doc.views.forEach((view, index) =>
    children.push(createDocxLinkLine(`3.${index + 1} ${docxText(view.Name)}`, viewAnchors[index], 360)),
  );
  children.push(createDocxLinkLine('4. Routines', routinesAnchor));
  doc.routines.forEach((routine, index) =>
    children.push(
      createDocxLinkLine(
        `4.${index + 1} ${docxText(routine.detail.Name)} (${docxText(routine.detail.Type)})`,
        routineAnchors[index],
        360,
      ),
    ),
  );

  children.push(createDocxSectionTitle('Overview', true, overviewAnchor));
  children.push(createDocxKeyValueTable({
    GeneratedAt: doc.generatedAt,
    Connection: doc.connectionName,
    Host: doc.host,
    Database: doc.database,
    TableCount: doc.tables.length,
    ViewCount: doc.views.length,
    RoutineCount: doc.routines.length,
  }));

  children.push(createDocxSectionTitle('Tables', true, tablesAnchor));
  if (doc.tables.length === 0) {
    children.push(new Paragraph('-'));
  }
  doc.tables.forEach((table, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 120 },
        children: [
          new Bookmark({
            id: tableAnchors[index],
            children: [new TextRun({ text: docxText(table.detail.Name) })],
          }),
        ],
      }),
    );
    children.push(createDocxSubTitle('Properties'));
    children.push(createDocxKeyValueTable(table.detail as unknown as Record<string, unknown>));

    children.push(createDocxSubTitle('Columns'));
    children.push(createDocxRecordTable(table.columns));

    children.push(createDocxSubTitle('Indexes'));
    children.push(createDocxRecordTable(table.indexes));

    children.push(createDocxSubTitle('Foreign Keys'));
    children.push(createDocxRecordTable(table.foreignKeys));

    children.push(createDocxSubTitle('Checks'));
    children.push(createDocxRecordTable(table.checks));

    children.push(createDocxSubTitle('Triggers'));
    children.push(createDocxRecordTable(table.triggers));
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  });

  children.push(createDocxSectionTitle('Views', true, viewsAnchor));
  if (doc.views.length === 0) {
    children.push(new Paragraph('-'));
  }
  doc.views.forEach((view, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 120 },
        children: [
          new Bookmark({
            id: viewAnchors[index],
            children: [new TextRun({ text: docxText(view.Name) })],
          }),
        ],
      }),
    );
    children.push(createDocxSubTitle('Properties'));
    children.push(createDocxKeyValueTable(view as unknown as Record<string, unknown>));

    if (view.Definition) {
      children.push(createDocxSubTitle('Definition'));
      children.push(createDocxCodeBlock(view.Definition));
    }
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  });

  children.push(createDocxSectionTitle('Routines', true, routinesAnchor));
  if (doc.routines.length === 0) {
    children.push(new Paragraph('-'));
  }
  doc.routines.forEach((routine, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 220, after: 120 },
        children: [
          new Bookmark({
            id: routineAnchors[index],
            children: [new TextRun({ text: `${docxText(routine.detail.Name)} (${docxText(routine.detail.Type)})` })],
          }),
        ],
      }),
    );
    children.push(createDocxSubTitle('Properties'));
    children.push(createDocxKeyValueTable(routine.detail as unknown as Record<string, unknown>));

    children.push(createDocxSubTitle('Params'));
    const paramRecords = routine.params.map((param) => ({
      MODE: param.mode || '',
      NAME: param.name,
      TYPE: param.type,
    }));
    children.push(createDocxRecordTable(paramRecords));

    if (routine.detail.Definition) {
      children.push(createDocxSubTitle('Definition'));
      children.push(createDocxCodeBlock(routine.detail.Definition));
    }

    if (routine.ddl) {
      children.push(createDocxSubTitle('DDL'));
      children.push(createDocxCodeBlock(routine.ddl));
    }
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  });

  const docx = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  const arrayBuffer = await Packer.toArrayBuffer(docx);
  return new Uint8Array(arrayBuffer);
};

interface PdfAnchorPoint {
  page: number;
  y: number;
}

interface PendingPdfLink {
  tocPage: number;
  x: number;
  y: number;
  w: number;
  h: number;
  targetId: string;
}

const PDF_CJK_FONT_FAMILY = 'SongtiSCBlack';
const PDF_CJK_FONT_FILE = `${PDF_CJK_FONT_FAMILY}-normal.ttf`;

const registerPdfCjkFont = (pdf: jsPDF): void => {
  try {
    pdf.addFileToVFS(PDF_CJK_FONT_FILE, SongtiSCBlack);
  } catch {
    // ignore duplicate registration on same document instance
  }
  try {
    pdf.addFont(PDF_CJK_FONT_FILE, PDF_CJK_FONT_FAMILY, 'normal');
  } catch {
    // ignore duplicate registration on same document instance
  }
  pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
};

const buildPdfBytes = async (doc: DictionaryDocument): Promise<Uint8Array> => {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  registerPdfCjkFont(pdf);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 30;
  const contentWidth = pageWidth - margin * 2;
  const pageBottom = pageHeight - margin;

  let cursorY = margin;
  const anchors = new Map<string, PdfAnchorPoint>();
  const pendingLinks: PendingPdfLink[] = [];

  const lineHeight = 14;

  const addPageIfNeeded = (requiredHeight = lineHeight) => {
    if (cursorY + requiredHeight > pageBottom) {
      pdf.addPage();
      cursorY = margin;
    }
  };

  const addSpace = (height: number) => {
    addPageIfNeeded(height);
    cursorY += height;
  };

  const syncCursorFromAutoTable = (fallback = cursorY) => {
    const lastAutoTable = (pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    cursorY = (lastAutoTable?.finalY ?? fallback) + 8;
  };

  const addWrappedText = (
    text: string,
    options?: { x?: number; color?: [number, number, number]; fontSize?: number; fontStyle?: 'normal' | 'bold' },
  ) => {
    const x = options?.x ?? margin;
    const fontSize = options?.fontSize ?? 11;
    const color = options?.color ?? [15, 23, 42];
    const fontStyle = options?.fontStyle ?? 'normal';
    const maxWidth = pageWidth - x - margin;

    pdf.setFont(PDF_CJK_FONT_FAMILY, fontStyle === 'bold' ? 'normal' : 'normal');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(color[0], color[1], color[2]);

    const lines = pdf.splitTextToSize(normalizePdfText(text), maxWidth) as string[];
    const textLineHeight = Math.max(lineHeight, Math.round(fontSize * 1.45));

    lines.forEach((line) => {
      addPageIfNeeded(textLineHeight);
      pdf.text(String(line), x, cursorY);
      cursorY += textLineHeight;
    });
  };

  const addSectionTitle = (text: string, anchorId?: string) => {
    addSpace(8);
    addPageIfNeeded(24);
    if (anchorId) {
      anchors.set(anchorId, { page: pdf.getNumberOfPages(), y: cursorY - 2 });
    }
    pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
    pdf.setFontSize(17);
    pdf.setTextColor(15, 23, 42);
    pdf.text(text, margin, cursorY);
    cursorY += 16;

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(1);
    pdf.line(margin, cursorY, pageWidth - margin, cursorY);
    cursorY += 10;
  };

  const addSubTitle = (text: string, anchorId?: string) => {
    addPageIfNeeded(18);
    if (anchorId) {
      anchors.set(anchorId, { page: pdf.getNumberOfPages(), y: cursorY - 2 });
    }
    pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
    pdf.setFontSize(13);
    pdf.setTextColor(30, 41, 59);
    pdf.text(text, margin, cursorY);
    cursorY += 12;
  };

  const addKeyValues = (record: Record<string, unknown>) => {
    const body = Object.entries(record).map(([key, value]) => [normalizePdfText(key), normalizePdfText(value)]);

    autoTable(pdf, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      body,
      theme: 'grid',
      styles: {
        font: PDF_CJK_FONT_FAMILY,
        fontSize: 10,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.6,
        cellPadding: { top: 3, right: 5, bottom: 3, left: 5 },
        overflow: 'linebreak',
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 170, fillColor: [248, 250, 252], textColor: [51, 65, 85] },
        1: { cellWidth: 'auto' },
      },
    });

    syncCursorFromAutoTable();
  };

  const addRecordGrid = (records: MetadataRecord[]) => {
    if (records.length === 0) {
      addWrappedText('-', { color: [148, 163, 184] });
      return;
    }

    const keys = getRecordKeys(records);
    const head = [keys.map((key) => normalizePdfText(key))];
    const body = records.map((record) => keys.map((key) => normalizePdfText(record[key])));

    autoTable(pdf, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: contentWidth,
      head,
      body,
      theme: 'grid',
      styles: {
        font: PDF_CJK_FONT_FAMILY,
        fontSize: 9,
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.6,
        cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
        overflow: 'linebreak',
        valign: 'top',
      },
      headStyles: {
        fillColor: [248, 250, 252],
        textColor: [51, 65, 85],
      },
      didDrawPage: () => {
        // Keep color state stable across page breaks
        pdf.setTextColor(15, 23, 42);
      },
    });

    syncCursorFromAutoTable();
  };

  const addTocLinkLine = (text: string, targetId: string, level = 0) => {
    const x = margin + level * 16;
    const maxWidth = pageWidth - x - margin;

    pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(29, 78, 216);

    const lines = pdf.splitTextToSize(normalizePdfText(text), maxWidth) as string[];
    lines.forEach((line) => {
      addPageIfNeeded(lineHeight);
      const lineText = String(line);
      pdf.text(lineText, x, cursorY);

      pendingLinks.push({
        tocPage: pdf.getNumberOfPages(),
        x,
        y: cursorY - lineHeight + 2,
        w: Math.min(pdf.getTextWidth(lineText), maxWidth),
        h: lineHeight,
        targetId,
      });

      cursorY += lineHeight;
    });
  };

  const coverTop = cursorY;
  const coverPaddingX = 20;
  const coverTopPadding = 18;
  const coverTitleHeight = 52;
  const coverMetaTopGap = 20;
  const coverRowGap = 8;
  const coverTextLineHeight = 14;
  const coverBodyWidth = contentWidth - coverPaddingX * 2;
  const coverColumnGap = 12;
  const coverColumnWidth = (coverBodyWidth - coverColumnGap) / 2;

  const coverRows = [
    [`Generated At: ${normalizePdfText(doc.generatedAt)}`, `Connection: ${normalizePdfText(doc.connectionName)}`],
    [`Host: ${normalizePdfText(doc.host)}`, `Database: ${normalizePdfText(doc.database)}`],
    [`Tables: ${doc.tables.length}`, `Views: ${doc.views.length}`],
    [`Routines: ${doc.routines.length}`, ''],
  ];

  const coverRowLineSets = coverRows.map(([left, right]) => ({
    left: pdf.splitTextToSize(left, coverColumnWidth) as string[],
    right: right ? ((pdf.splitTextToSize(right, coverColumnWidth) as string[]) || []) : [],
  }));
  const coverMetaHeight = coverRowLineSets.reduce(
    (sum, row, index) =>
      sum + Math.max(row.left.length, row.right.length, 1) * coverTextLineHeight + (index < coverRowLineSets.length - 1 ? coverRowGap : 0),
    0,
  );
  const coverHeight = coverTopPadding + coverTitleHeight + coverMetaTopGap + coverMetaHeight + 16;

  addPageIfNeeded(coverHeight + 4);
  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(219, 234, 254);
  pdf.roundedRect(margin, coverTop, contentWidth, coverHeight, 8, 8, 'FD');

  pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
  pdf.setFontSize(30);
  pdf.setTextColor(29, 78, 216);
  pdf.text('Data Dictionary', margin + coverPaddingX, coverTop + coverTopPadding + 24);

  pdf.setFontSize(18);
  pdf.setTextColor(30, 41, 59);
  pdf.text(normalizePdfText(doc.database), margin + coverPaddingX, coverTop + coverTopPadding + 50);

  pdf.setFont(PDF_CJK_FONT_FAMILY, 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(51, 65, 85);

  const leftMetaX = margin + coverPaddingX;
  const rightMetaX = leftMetaX + coverColumnWidth + coverColumnGap;
  let rowY = coverTop + coverTopPadding + coverTitleHeight + coverMetaTopGap;

  coverRowLineSets.forEach((row, index) => {
    const rowLineCount = Math.max(row.left.length, row.right.length, 1);
    row.left.forEach((line, lineIndex) => {
      pdf.text(String(line), leftMetaX, rowY + lineIndex * coverTextLineHeight);
    });
    row.right.forEach((line, lineIndex) => {
      pdf.text(String(line), rightMetaX, rowY + lineIndex * coverTextLineHeight);
    });
    rowY += rowLineCount * coverTextLineHeight + (index < coverRowLineSets.length - 1 ? coverRowGap : 0);
  });

  cursorY = coverTop + coverHeight + 12;

  addSectionTitle('Table of Contents');
  addTocLinkLine('1. Overview', 'overview');
  addTocLinkLine('2. Tables', 'tables');
  doc.tables.forEach((table, index) =>
    addTocLinkLine(`2.${index + 1} ${normalizePdfText(table.detail.Name)}`, `table-${index + 1}`, 1),
  );
  addTocLinkLine('3. Views', 'views');
  doc.views.forEach((view, index) =>
    addTocLinkLine(`3.${index + 1} ${normalizePdfText(view.Name)}`, `view-${index + 1}`, 1),
  );
  addTocLinkLine('4. Routines', 'routines');
  doc.routines.forEach((routine, index) =>
    addTocLinkLine(
      `4.${index + 1} ${normalizePdfText(routine.detail.Name)} (${normalizePdfText(routine.detail.Type)})`,
      `routine-${index + 1}`,
      1,
    ),
  );

  addSectionTitle('Overview', 'overview');
  addKeyValues({
    GeneratedAt: normalizePdfText(doc.generatedAt),
    Connection: normalizePdfText(doc.connectionName),
    Host: normalizePdfText(doc.host),
    Database: normalizePdfText(doc.database),
    TableCount: doc.tables.length,
    ViewCount: doc.views.length,
    RoutineCount: doc.routines.length,
  });

  addSectionTitle('Tables', 'tables');
  if (doc.tables.length === 0) {
    addWrappedText('-', { color: [148, 163, 184] });
  }
  doc.tables.forEach((table, index) => {
    addSubTitle(normalizePdfText(table.detail.Name), `table-${index + 1}`);
    addKeyValues(table.detail as unknown as Record<string, unknown>);

    addWrappedText('Columns', { fontStyle: 'bold', color: [71, 85, 105] });
    addRecordGrid(table.columns);

    addWrappedText('Indexes', { fontStyle: 'bold', color: [71, 85, 105] });
    addRecordGrid(table.indexes);

    addWrappedText('Foreign Keys', { fontStyle: 'bold', color: [71, 85, 105] });
    addRecordGrid(table.foreignKeys);

    addWrappedText('Checks', { fontStyle: 'bold', color: [71, 85, 105] });
    addRecordGrid(table.checks);

    addWrappedText('Triggers', { fontStyle: 'bold', color: [71, 85, 105] });
    addRecordGrid(table.triggers);
    addSpace(6);
  });

  addSectionTitle('Views', 'views');
  if (doc.views.length === 0) {
    addWrappedText('-', { color: [148, 163, 184] });
  }
  doc.views.forEach((view, index) => {
    addSubTitle(normalizePdfText(view.Name), `view-${index + 1}`);
    addKeyValues(view as unknown as Record<string, unknown>);
    addSpace(6);
  });

  addSectionTitle('Routines', 'routines');
  if (doc.routines.length === 0) {
    addWrappedText('-', { color: [148, 163, 184] });
  }
  doc.routines.forEach((routine, index) => {
    addSubTitle(`${normalizePdfText(routine.detail.Name)} (${normalizePdfText(routine.detail.Type)})`, `routine-${index + 1}`);
    addKeyValues(routine.detail as unknown as Record<string, unknown>);

    addWrappedText('Params', { fontStyle: 'bold', color: [71, 85, 105] });
    const paramRecords = routine.params.map((param) => ({
      MODE: param.mode || '',
      NAME: param.name,
      TYPE: param.type,
    }));
    addRecordGrid(paramRecords);

    if (routine.ddl) {
      addWrappedText('DDL', { fontStyle: 'bold', color: [71, 85, 105] });
      routine.ddl
        .split(/\r?\n/)
        .forEach((line) => addWrappedText(normalizePdfText(line), { fontSize: 10, color: [30, 41, 59] }));
    }
    addSpace(6);
  });

  pendingLinks.forEach((item) => {
    const target = anchors.get(item.targetId);
    if (!target) return;
    pdf.setPage(item.tocPage);
    pdf.link(item.x, item.y, item.w, item.h, {
      pageNumber: target.page,
      top: Math.max(0, target.y - 8),
      zoom: 1,
    });
  });

  return new Uint8Array(pdf.output('arraybuffer'));
};

export const DataDictionaryTab: React.FC<DataDictionaryTabProps> = ({
  tabId: _tabId,
  connectionProfile,
  database,
}) => {
  const { t } = useTranslation();

  const [includeRoutineDdl, setIncludeRoutineDdl] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');

  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  const [catalog, setCatalog] = useState<ObjectCatalog>({ tables: [], views: [], routines: [] });
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [selectedViews, setSelectedViews] = useState<string[]>([]);
  const [selectedRoutines, setSelectedRoutines] = useState<string[]>([]);

  const [documentData, setDocumentData] = useState<DictionaryDocument | null>(null);

  const previewBodyHtml = useMemo(() => {
    if (!documentData) return '';
    return buildHtmlBody(documentData);
  }, [documentData]);

  const loadObjectCatalog = useCallback(async () => {
    setIsLoadingCatalog(true);
    setErrorText('');
    setStatusText(t('dataDictionary.status.loadingObjects'));

    try {
      const [tables, views, routines] = await Promise.all([
        metadataApi.listTableDetails(connectionProfile, database),
        metadataApi.listViewDetails(connectionProfile, database),
        metadataApi.listFunctionDetails(connectionProfile, database),
      ]);

      setCatalog({ tables, views, routines });
      setSelectedTables(tables.map((item) => item.Name));
      setSelectedViews(views.map((item) => item.Name));
      setSelectedRoutines(routines.map((item) => item.Name));

      setStatusText(
        t('dataDictionary.status.objectsLoaded', {
          tables: tables.length,
          views: views.length,
          routines: routines.length,
        }),
      );
    } catch (error) {
      setErrorText(t('dataDictionary.status.loadObjectsFailed', { error: String(error) }));
      setStatusText('');
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [connectionProfile, database, t]);

  const toggleItem = (
    group: 'table' | 'view' | 'routine',
    name: string,
    checked: boolean,
  ) => {
    const updater = (prev: string[]) =>
      checked ? (prev.includes(name) ? prev : [...prev, name]) : prev.filter((item) => item !== name);

    if (group === 'table') {
      setSelectedTables(updater);
      return;
    }
    if (group === 'view') {
      setSelectedViews(updater);
      return;
    }
    setSelectedRoutines(updater);
  };

  const toggleAll = (group: 'table' | 'view' | 'routine', checked: boolean) => {
    if (group === 'table') {
      setSelectedTables(checked ? catalog.tables.map((item) => item.Name) : []);
      return;
    }
    if (group === 'view') {
      setSelectedViews(checked ? catalog.views.map((item) => item.Name) : []);
      return;
    }
    setSelectedRoutines(checked ? catalog.routines.map((item) => item.Name) : []);
  };

  const hasAnySelection =
    selectedTables.length > 0 || selectedViews.length > 0 || selectedRoutines.length > 0;

  const generateDictionary = async () => {
    if (!hasAnySelection) {
      setErrorText(t('dataDictionary.status.noObjectSelected'));
      setStatusText('');
      return;
    }

    setIsGenerating(true);
    setErrorText('');
    setStatusText(t('dataDictionary.status.generating'));

    try {
      const generatedAt = new Date().toLocaleString();

      const selectedTableDetails = catalog.tables.filter((detail) =>
        selectedTables.includes(detail.Name),
      );
      const selectedViewDetails = catalog.views.filter((detail) => selectedViews.includes(detail.Name));
      const selectedRoutineDetails = catalog.routines.filter((detail) =>
        selectedRoutines.includes(detail.Name),
      );

      const tables: TableDictionaryItem[] = await Promise.all(
        selectedTableDetails.map(async (detail) => {
          const [columns, indexes, foreignKeys, checks, triggers] = await Promise.all([
            metadataApi.listColumns(connectionProfile, database, detail.Name),
            metadataApi.listIndexes(connectionProfile, database, detail.Name),
            metadataApi.listForeignKeys(connectionProfile, database, detail.Name),
            metadataApi.listChecks(connectionProfile, database, detail.Name),
            metadataApi.listTriggers(connectionProfile, database, detail.Name),
          ]);
          return {
            detail,
            columns,
            indexes,
            foreignKeys,
            checks,
            triggers,
          };
        }),
      );

      const routines: RoutineDictionaryItem[] = await Promise.all(
        selectedRoutineDetails.map(async (routine) => {
          const params = await metadataApi.getRoutineParams(connectionProfile, database, routine.Name);
          let ddl: string | undefined;
          if (includeRoutineDdl) {
            ddl = await metadataApi.getFunctionDdl(
              connectionProfile,
              database,
              routine.Name,
              routine.Type,
            );
          }
          return {
            detail: routine,
            params,
            ddl,
          };
        }),
      );

      setDocumentData({
        generatedAt,
        connectionName: connectionProfile.name || `${connectionProfile.host}:${connectionProfile.port}`,
        host: connectionProfile.host,
        database,
        tables,
        views: selectedViewDetails,
        routines,
      });

      setStatusText(
        t('dataDictionary.status.generated', {
          tables: tables.length,
          views: selectedViewDetails.length,
          routines: routines.length,
        }),
      );
    } catch (error) {
      setErrorText(t('dataDictionary.status.generateFailed', { error: String(error) }));
      setStatusText('');
    } finally {
      setIsGenerating(false);
    }
  };

  const exportDictionary = async () => {
    if (!documentData) return;

    setIsExporting(true);
    setErrorText('');

    try {
      const extension = exportFormat;
      const defaultName = `${database}_data_dictionary.${extension}`;
      const targetPath = await save({
        title: t('dataDictionary.export.title'),
        defaultPath: defaultName,
        filters: [
          {
            name: exportFormat.toUpperCase(),
            extensions: [extension],
          },
        ],
        canCreateDirectories: true,
      });

      if (!targetPath) {
        setIsExporting(false);
        return;
      }

      if (exportFormat === 'html') {
        await writeTextFile(targetPath, buildHtmlDocument(documentData));
      } else if (exportFormat === 'markdown') {
        await writeTextFile(targetPath, buildMarkdown(documentData));
      } else if (exportFormat === 'json') {
        await writeTextFile(targetPath, JSON.stringify(documentData, null, 2));
      } else if (exportFormat === 'docx') {
        const bytes = await buildDocxBytes(documentData);
        await writeFile(targetPath, bytes);
      } else {
        const bytes = await buildPdfBytes(documentData);
        await writeFile(targetPath, bytes);
      }

      setStatusText(t('dataDictionary.status.exported', { path: targetPath }));
    } catch (error) {
      setErrorText(t('dataDictionary.status.exportFailed', { error: String(error) }));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="data-dictionary-tab">
      <div className="data-dictionary-scroll">
        <div className="data-dictionary-header">
          <h2 className="data-dictionary-title">{t('dataDictionary.title')}</h2>
          <p className="data-dictionary-subtitle">
            {t('dataDictionary.subtitle', {
              database,
              connection: connectionProfile.name || `${connectionProfile.host}:${connectionProfile.port}`,
            })}
          </p>
        </div>

        <Card className="data-dictionary-card" elevation={1}>
          <div className="data-dictionary-card-header">
            <h3 className="data-dictionary-card-title">{t('dataDictionary.scope.title')}</h3>
            <Button small loading={isLoadingCatalog} onClick={loadObjectCatalog}>
              {t('dataDictionary.actions.loadObjects')}
            </Button>
          </div>

          <div className="data-dictionary-objects-grid">
            <div className="data-dictionary-object-group">
              <div className="data-dictionary-object-group-header">
                <Checkbox
                  checked={catalog.tables.length > 0 && selectedTables.length === catalog.tables.length}
                  indeterminate={selectedTables.length > 0 && selectedTables.length < catalog.tables.length}
                  onChange={(event) => toggleAll('table', (event.target as HTMLInputElement).checked)}
                  label={`${t('dataDictionary.scope.tableGroup')} (${selectedTables.length}/${catalog.tables.length})`}
                />
              </div>
              <div className="data-dictionary-object-list">
                {catalog.tables.map((table) => (
                  <Checkbox
                    key={`table-${table.Name}`}
                    checked={selectedTables.includes(table.Name)}
                    label={table.Name}
                    onChange={(event) =>
                      toggleItem('table', table.Name, (event.target as HTMLInputElement).checked)
                    }
                  />
                ))}
              </div>
            </div>

            <div className="data-dictionary-object-group">
              <div className="data-dictionary-object-group-header">
                <Checkbox
                  checked={catalog.views.length > 0 && selectedViews.length === catalog.views.length}
                  indeterminate={selectedViews.length > 0 && selectedViews.length < catalog.views.length}
                  onChange={(event) => toggleAll('view', (event.target as HTMLInputElement).checked)}
                  label={`${t('dataDictionary.scope.viewGroup')} (${selectedViews.length}/${catalog.views.length})`}
                />
              </div>
              <div className="data-dictionary-object-list">
                {catalog.views.map((view) => (
                  <Checkbox
                    key={`view-${view.Name}`}
                    checked={selectedViews.includes(view.Name)}
                    label={view.Name}
                    onChange={(event) =>
                      toggleItem('view', view.Name, (event.target as HTMLInputElement).checked)
                    }
                  />
                ))}
              </div>
            </div>

            <div className="data-dictionary-object-group">
              <div className="data-dictionary-object-group-header">
                <Checkbox
                  checked={catalog.routines.length > 0 && selectedRoutines.length === catalog.routines.length}
                  indeterminate={selectedRoutines.length > 0 && selectedRoutines.length < catalog.routines.length}
                  onChange={(event) =>
                    toggleAll('routine', (event.target as HTMLInputElement).checked)
                  }
                  label={`${t('dataDictionary.scope.routineGroup')} (${selectedRoutines.length}/${catalog.routines.length})`}
                />
              </div>
              <div className="data-dictionary-object-list">
                {catalog.routines.map((routine) => (
                  <Checkbox
                    key={`routine-${routine.Name}`}
                    checked={selectedRoutines.includes(routine.Name)}
                    label={`${routine.Name} (${routine.Type})`}
                    onChange={(event) =>
                      toggleItem('routine', routine.Name, (event.target as HTMLInputElement).checked)
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <Checkbox
            label={t('dataDictionary.scope.includeRoutineDdl')}
            checked={includeRoutineDdl}
            disabled={selectedRoutines.length === 0}
            onChange={(event) => setIncludeRoutineDdl((event.target as HTMLInputElement).checked)}
          />

          <div className="data-dictionary-actions">
            <Button
              intent="primary"
              loading={isGenerating}
              onClick={generateDictionary}
              disabled={isGenerating || !hasAnySelection}
            >
              {t('dataDictionary.actions.generate')}
            </Button>

            <HTMLSelect
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
              options={[
                { label: 'PDF (.pdf)', value: 'pdf' },
                { label: 'DOCX (.docx)', value: 'docx' },
                { label: 'HTML (.html)', value: 'html' },
                { label: 'Markdown (.md)', value: 'markdown' },
                { label: 'JSON (.json)', value: 'json' },
              ]}
            />

            <Button
              onClick={exportDictionary}
              disabled={!documentData || isGenerating || isExporting}
              loading={isExporting}
            >
              {t('dataDictionary.actions.export')}
            </Button>
          </div>
        </Card>

        <Card className="data-dictionary-card" elevation={1}>
          <h3 className="data-dictionary-card-title">{t('dataDictionary.preview.title')}</h3>

          {isGenerating && (
            <div className="data-dictionary-loading">
              <Spinner size={20} />
              <span>{t('dataDictionary.status.generating')}</span>
            </div>
          )}

          {!isGenerating && previewBodyHtml && (
            <>
              <style>{PREVIEW_STYLE}</style>
              <div
                className="data-dictionary-preview-document"
                dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
              />
            </>
          )}

          {!isGenerating && !previewBodyHtml && (
            <div className="data-dictionary-empty">{t('dataDictionary.preview.empty')}</div>
          )}
        </Card>

        {(statusText || errorText) && (
          <div className="data-dictionary-status-wrap">
            {statusText && <div className="data-dictionary-status">{statusText}</div>}
            {errorText && <div className="data-dictionary-error">{errorText}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
