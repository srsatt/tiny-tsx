use crate::hir::{ConstantField, ConstantValue};

const NULL: u8 = 0;
const FALSE: u8 = 1;
const TRUE: u8 = 2;
const NUMBER: u8 = 3;
const STRING: u8 = 4;
const ARRAY: u8 = 5;
const RECORD: u8 = 6;
const UNDEFINED: u8 = 7;
const BIGINT: u8 = 8;

pub(super) fn encode(value: &ConstantValue) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    encode_value(value, &mut bytes)?;
    Ok(bytes)
}

fn encode_value(value: &ConstantValue, bytes: &mut Vec<u8>) -> Result<(), String> {
    match value {
        ConstantValue::Undefined => bytes.push(UNDEFINED),
        ConstantValue::Null => bytes.push(NULL),
        ConstantValue::Boolean { value } => bytes.push(if *value { TRUE } else { FALSE }),
        ConstantValue::Number { value } => {
            bytes.push(NUMBER);
            bytes.extend(value.to_le_bytes());
        }
        ConstantValue::Bigint { value } => {
            bytes.push(BIGINT);
            encode_string(value, bytes)?;
        }
        ConstantValue::String { value } => {
            bytes.push(STRING);
            encode_string(value, bytes)?;
        }
        ConstantValue::Array { items } => {
            bytes.push(ARRAY);
            encode_length(items.len(), bytes)?;
            for item in items {
                encode_value(item, bytes)?;
            }
        }
        ConstantValue::Record { fields } => {
            bytes.push(RECORD);
            encode_length(fields.len(), bytes)?;
            for field in fields {
                encode_field(field, bytes)?;
            }
        }
    }
    Ok(())
}

fn encode_field(field: &ConstantField, bytes: &mut Vec<u8>) -> Result<(), String> {
    encode_string(&field.name, bytes)?;
    encode_value(&field.value, bytes)
}

fn encode_string(value: &str, bytes: &mut Vec<u8>) -> Result<(), String> {
    encode_length(value.len(), bytes)?;
    bytes.extend(value.as_bytes());
    Ok(())
}

fn encode_length(length: usize, bytes: &mut Vec<u8>) -> Result<(), String> {
    let length = u32::try_from(length).map_err(|_| "constant data exceeds 4 GiB".to_owned())?;
    bytes.extend(length.to_le_bytes());
    Ok(())
}

#[cfg(test)]
#[path = "constant_data_tests.rs"]
mod tests;
