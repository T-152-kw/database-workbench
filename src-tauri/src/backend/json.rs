use serde_json::Value as JsonValue;

pub fn parse_to_canonical_json(input: &str) -> Result<String, String> {
    let value: JsonValue =
        serde_json::from_str(input).map_err(|e| format!("Failed to parse JSON: {e}"))?;
    serde_json::to_string(&value).map_err(|e| format!("Failed to serialize JSON: {e}"))
}
