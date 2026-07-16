use crate::hir::{ConstantField, ConstantValue};

use super::encode;

#[test]
fn encodes_nested_values_with_stable_tags_and_lengths() {
    let value = ConstantValue::Record {
        fields: vec![ConstantField {
            name: "ok".to_owned(),
            value: ConstantValue::Array {
                items: vec![ConstantValue::Boolean { value: true }, ConstantValue::Null],
            },
        }],
    };

    assert_eq!(
        encode(&value).unwrap(),
        vec![6, 1, 0, 0, 0, 2, 0, 0, 0, b'o', b'k', 5, 2, 0, 0, 0, 2, 0]
    );
}

#[test]
fn encodes_undefined_and_arbitrary_precision_bigint() {
    assert_eq!(encode(&ConstantValue::Undefined).unwrap(), vec![7]);
    assert_eq!(
        encode(&ConstantValue::Bigint {
            value: "9007199254740993".to_owned(),
        })
        .unwrap(),
        vec![
            8, 16, 0, 0, 0, b'9', b'0', b'0', b'7', b'1', b'9', b'9', b'2', b'5', b'4', b'7', b'4',
            b'0', b'9', b'9', b'3',
        ]
    );
}
