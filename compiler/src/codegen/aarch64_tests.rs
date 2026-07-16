use crate::hir::{SourceSpan, ValueExpression};

use super::value_frame_size;

fn span() -> SourceSpan {
    SourceSpan {
        file: "test.ts".to_owned(),
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 2,
    }
}

#[test]
fn frame_size_tracks_nested_call_scratch_and_alignment() {
    let expression = ValueExpression::DirectCall {
        function: 0,
        arguments: vec![ValueExpression::DirectCall {
            function: 1,
            arguments: vec![ValueExpression::StringLiteral {
                string: 0,
                span: span(),
            }],
            span: span(),
        }],
        span: span(),
    };

    assert_eq!(value_frame_size(16, &expression), Ok(48));
}
