use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub version: u32,
    pub target: String,
    #[serde(default, skip_serializing_if = "ServerOptions::is_default")]
    pub server: ServerOptions,
    pub entry: String,
    pub modules: Vec<Module>,
    #[serde(default)]
    pub functions: Vec<Function>,
    pub components: Vec<Component>,
    #[serde(default)]
    pub workers: Vec<WorkerModule>,
    #[serde(default)]
    pub supervisors: Vec<SupervisorModule>,
    #[serde(default)]
    pub actors: Vec<ActorModule>,
    #[serde(default, rename = "sqliteDatabases")]
    pub sqlite_databases: Vec<SqliteDatabase>,
    #[serde(default, rename = "assetStores")]
    pub asset_stores: Vec<AssetStore>,
    pub handlers: Vec<Handler>,
    pub static_strings: Vec<StaticString>,
    #[serde(default)]
    pub constants: Vec<Constant>,
    #[serde(default)]
    pub memory: MemoryReport,
    pub statistics: Statistics,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

impl ServerOptions {
    fn is_default(&self) -> bool {
        self.port.is_none()
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Module {
    pub path: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReport {
    pub policy: String,
    pub managed_heap_required: bool,
    #[serde(default)]
    pub sites: Vec<MemoryAllocationSite>,
    pub summary: MemorySummary,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryAllocationSite {
    pub module: String,
    pub line: usize,
    pub column: usize,
    pub value_kind: String,
    pub instances: usize,
    pub max_references: usize,
    pub lifetime: String,
    pub escape: String,
}

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySummary {
    pub compile_time: usize,
    #[serde(rename = "static")]
    pub static_sites: usize,
    pub request: usize,
    pub worker: usize,
    pub message: usize,
    pub managed: usize,
    pub aliased_sites: usize,
    pub response_escapes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Component {
    pub id: usize,
    pub name: String,
    pub span: SourceSpan,
    pub html: Vec<HtmlOp>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WorkerModule {
    pub id: usize,
    pub module: String,
    pub operation: WorkerOperation,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkerOperation {
    AsciiUppercase,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorModule {
    pub id: usize,
    pub operation: ActorOperation,
    pub initial_state: i64,
    #[serde(default)]
    pub initial_json: Option<usize>,
    pub mailbox_capacity: usize,
    #[serde(default)]
    pub failure_message: Option<i64>,
    #[serde(default)]
    pub restart: Option<ActorRestart>,
    #[serde(default)]
    pub supervisor: Option<usize>,
    #[serde(default)]
    pub persistence: Option<ActorPersistence>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorModule {
    pub id: usize,
    pub strategy: SupervisorStrategy,
    pub max_restarts: usize,
    pub within_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SupervisorStrategy {
    OneForOne,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorRestart {
    pub max_restarts: usize,
    pub within_ms: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ActorPersistence {
    pub database: usize,
    pub key: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ActorOperation {
    Counter,
    FallibleCounter,
    JsonMailbox,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ActorAction {
    Tell {
        actor: usize,
        #[serde(default)]
        message: Option<i64>,
        #[serde(default, rename = "jsonMessage")]
        json_message: Option<usize>,
    },
    Stop {
        actor: usize,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SqliteDatabase {
    pub id: usize,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub binding: Option<String>,
    #[serde(default)]
    pub readonly: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStore {
    pub id: usize,
    pub name: String,
    pub index: String,
    pub spa_fallback: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SqliteAction {
    Exec {
        database: usize,
        sql: usize,
        #[serde(default)]
        parameters: Vec<SqliteParameter>,
        #[serde(default)]
        result: Option<usize>,
    },
    Transaction {
        database: usize,
        sql: usize,
    },
    TransactionSteps {
        database: usize,
        steps: Vec<SqliteTransactionStep>,
    },
    Close {
        database: usize,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SqliteTransactionStep {
    pub sql: usize,
    #[serde(default)]
    pub parameters: Vec<SqliteParameter>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SqliteParameter {
    RouteParameter { segment: usize },
    RequestJsonField { field: usize },
    RequestHeader { header: usize },
    RandomUuid,
    StaticString { string: usize },
    StaticInteger { value: i64 },
    StaticReal { value: f64 },
    StaticBoolean { value: bool },
    Null,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HtmlOp {
    WriteStatic { string: usize, span: SourceSpan },
    CallComponent { component: usize, span: SourceSpan },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Handler {
    pub method: String,
    #[serde(default = "root_path")]
    pub path: String,
    #[serde(default)]
    pub headers: Vec<StaticHeader>,
    #[serde(default, rename = "elapsedHeaders")]
    pub elapsed_headers: Vec<ElapsedHeader>,
    #[serde(default, rename = "basicAuthorization")]
    pub basic_authorization: Option<BasicAuthorization>,
    #[serde(default, rename = "sessionAuthorization")]
    pub session_authorization: Option<SessionAuthorization>,
    #[serde(default, rename = "requestId")]
    pub request_id: Option<RequestId>,
    #[serde(default, rename = "bodyLimit")]
    pub body_limit: Option<BodyLimit>,
    #[serde(default, rename = "entityTag")]
    pub entity_tag: Option<EntityTag>,
    #[serde(default, rename = "sqliteExistence")]
    pub sqlite_existence: Option<SqliteExistence>,
    #[serde(default, rename = "parameterValidations")]
    pub parameter_validations: Vec<ParameterValidation>,
    #[serde(default, rename = "actorActions")]
    pub actor_actions: Vec<ActorAction>,
    #[serde(default, rename = "sqliteActions")]
    pub sqlite_actions: Vec<SqliteAction>,
    #[serde(default)]
    pub stderr: Vec<usize>,
    pub response: HandlerResponse,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SqliteExistence {
    pub database: usize,
    pub sql: usize,
    #[serde(default)]
    pub parameters: Vec<SqliteParameter>,
    pub missing: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterValidation {
    pub name: String,
    pub segment: usize,
    pub min_length: usize,
    pub rejected: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StaticHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ElapsedHeader {
    pub name: String,
    pub suffix: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BasicAuthorization {
    pub credentials: Vec<BasicCredential>,
    pub rejected: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SessionAuthorization {
    pub mode: String,
    pub cookie: usize,
    pub rejected: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestId {
    pub header: usize,
    pub max_length: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyLimit {
    pub max_bytes: usize,
    pub rejected: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BasicCredential {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct EntityTag {
    pub value: String,
    #[serde(rename = "notModified")]
    pub not_modified: GuardedResponse,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GuardedResponse {
    #[serde(default)]
    pub headers: Vec<StaticHeader>,
    #[serde(default)]
    pub stderr: Vec<usize>,
    pub response: HandlerResponse,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HandlerResponse {
    Html {
        component: usize,
    },
    Asset {
        store: usize,
    },
    Text {
        value: ValueExpression,
        #[serde(default = "ok_status")]
        status: u16,
        #[serde(default)]
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    Stream {
        chunks: Vec<ValueExpression>,
        #[serde(default = "ok_status")]
        status: u16,
        #[serde(default)]
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Function {
    pub id: usize,
    pub module: String,
    pub name: String,
    pub parameters: Vec<FunctionParameter>,
    pub result: String,
    pub body: ValueExpression,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FunctionParameter {
    pub name: String,
    #[serde(rename = "type")]
    pub value_type: String,
    pub span: SourceSpan,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SqliteQueryMode {
    All,
    First,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NumericOperator {
    Add,
    Subtract,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TodoOperation {
    List,
    Add,
    Complete,
    Delete,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TodoUser {
    StaticString { string: usize },
    RequestCookie { cookie: usize },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TodoArgument {
    RequestJsonField { field: usize },
    RouteParameter { segment: usize },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ValueExpression {
    StringLiteral {
        string: usize,
        span: SourceSpan,
    },
    NumericLiteral {
        value: i64,
        span: SourceSpan,
    },
    BooleanLiteral {
        value: bool,
        span: SourceSpan,
    },
    Constant {
        constant: usize,
        span: SourceSpan,
    },
    Parameter {
        parameter: usize,
        span: SourceSpan,
    },
    DirectCall {
        function: usize,
        arguments: Vec<ValueExpression>,
        span: SourceSpan,
    },
    StringEqualConditional {
        left: Box<ValueExpression>,
        right: Box<ValueExpression>,
        #[serde(rename = "whenEqual")]
        when_equal: Box<ValueExpression>,
        #[serde(rename = "whenNotEqual")]
        when_not_equal: Box<ValueExpression>,
        span: SourceSpan,
    },
    NumericBinary {
        operator: NumericOperator,
        left: Box<ValueExpression>,
        right: Box<ValueExpression>,
        span: SourceSpan,
    },
    NumericEqualConditional {
        left: Box<ValueExpression>,
        right: Box<ValueExpression>,
        #[serde(rename = "whenEqual")]
        when_equal: Box<ValueExpression>,
        #[serde(rename = "whenNotEqual")]
        when_not_equal: Box<ValueExpression>,
        span: SourceSpan,
    },
    BooleanEqualConditional {
        left: Box<ValueExpression>,
        right: Box<ValueExpression>,
        #[serde(rename = "whenEqual")]
        when_equal: Box<ValueExpression>,
        #[serde(rename = "whenNotEqual")]
        when_not_equal: Box<ValueExpression>,
        span: SourceSpan,
    },
    NumericForLoop {
        #[serde(rename = "accumulatorInitial")]
        accumulator_initial: i64,
        #[serde(rename = "indexInitial")]
        index_initial: i64,
        #[serde(rename = "endExclusive")]
        end_exclusive: i64,
        #[serde(rename = "accumulatorStep")]
        accumulator_step: i64,
        span: SourceSpan,
    },
    ThrowValue {
        value: Box<ValueExpression>,
        span: SourceSpan,
    },
    TryCatch {
        #[serde(rename = "tryValue")]
        try_value: Box<ValueExpression>,
        #[serde(rename = "catchValue")]
        catch_value: Box<ValueExpression>,
        span: SourceSpan,
    },
    CaughtException {
        span: SourceSpan,
    },
    Concat {
        values: Vec<ValueExpression>,
        span: SourceSpan,
    },
    RouteParameter {
        name: String,
        segment: usize,
        #[serde(default)]
        tail: bool,
        span: SourceSpan,
    },
    RequestHeader {
        header: usize,
        span: SourceSpan,
    },
    RequestJsonField {
        field: usize,
        span: SourceSpan,
    },
    RequestId {
        header: usize,
        span: SourceSpan,
    },
    SqliteRunChanges {
        result: usize,
        span: SourceSpan,
    },
    SqliteRunLastInsertRowId {
        result: usize,
        #[serde(default)]
        json: bool,
        span: SourceSpan,
    },
    RequestCookie {
        cookie: usize,
        fallback: Option<usize>,
        span: SourceSpan,
    },
    EnvironmentVariable {
        name: usize,
        required: bool,
        fallback: Option<usize>,
        span: SourceSpan,
    },
    FileText {
        path: usize,
        #[serde(rename = "maxBytes")]
        max_bytes: usize,
        span: SourceSpan,
    },
    ActorCall {
        actor: usize,
        #[serde(default)]
        message: Option<i64>,
        #[serde(default, rename = "jsonMessage")]
        json_message: Option<usize>,
        #[serde(default, rename = "timeoutMs")]
        timeout_ms: Option<u64>,
        span: SourceSpan,
    },
    SqliteQuery {
        database: usize,
        sql: usize,
        mode: SqliteQueryMode,
        #[serde(default)]
        parameters: Vec<SqliteParameter>,
        span: SourceSpan,
    },
    TodoStore {
        database: usize,
        operation: TodoOperation,
        user: TodoUser,
        #[serde(default)]
        argument: Option<TodoArgument>,
        span: SourceSpan,
    },
    FetchStatus {
        url: usize,
        span: SourceSpan,
    },
    QueryParameter {
        query: usize,
        fallback: Option<usize>,
        #[serde(rename = "escapeHtml")]
        escape_html: bool,
        span: SourceSpan,
    },
    QueryConditional {
        query: usize,
        #[serde(rename = "whenPresent")]
        when_present: Box<ValueExpression>,
        #[serde(rename = "whenAbsent")]
        when_absent: Box<ValueExpression>,
        span: SourceSpan,
    },
    WorkerCall {
        worker: usize,
        input: Box<ValueExpression>,
        span: SourceSpan,
    },
    OpenAiChatText {
        url: usize,
        authorization: usize,
        body: usize,
        span: SourceSpan,
    },
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StaticString {
    pub id: usize,
    pub value: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Constant {
    pub id: usize,
    pub module: String,
    pub name: String,
    pub span: SourceSpan,
    pub value: ConstantValue,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ConstantValue {
    Undefined,
    Null,
    Boolean {
        value: bool,
    },
    Number {
        value: f64,
    },
    NumberSpecial {
        value: SpecialNumber,
    },
    Symbol {
        id: u32,
        #[serde(default)]
        description: Option<String>,
    },
    Bigint {
        value: String,
    },
    String {
        value: String,
    },
    Array {
        items: Vec<ConstantValue>,
    },
    Record {
        fields: Vec<ConstantField>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SpecialNumber {
    NegativeZero,
    Nan,
    PositiveInfinity,
    NegativeInfinity,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ConstantField {
    pub name: String,
    pub value: ConstantValue,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub modules: usize,
    #[serde(default)]
    pub functions: usize,
    pub components: usize,
    #[serde(default)]
    pub constants: usize,
    pub static_html_bytes: usize,
    pub dynamic_html_expressions: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSpan {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
}

impl Program {
    pub fn uses_actors(&self) -> bool {
        !self.actors.is_empty()
    }

    pub fn uses_sqlite(&self) -> bool {
        !self.sqlite_databases.is_empty()
    }

    pub fn uses_filesystem(&self) -> bool {
        self.handlers.iter().any(|handler| {
            response_uses_filesystem(&handler.response)
                || handler
                    .basic_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_filesystem(&guard.rejected.response))
                || handler
                    .session_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_filesystem(&guard.rejected.response))
                || handler
                    .body_limit
                    .as_ref()
                    .is_some_and(|guard| response_uses_filesystem(&guard.rejected.response))
                || handler
                    .entity_tag
                    .as_ref()
                    .is_some_and(|guard| response_uses_filesystem(&guard.not_modified.response))
                || handler
                    .sqlite_existence
                    .as_ref()
                    .is_some_and(|guard| response_uses_filesystem(&guard.missing.response))
                || handler
                    .parameter_validations
                    .iter()
                    .any(|guard| response_uses_filesystem(&guard.rejected.response))
        })
    }

    pub fn environment_variable_ids(&self) -> Vec<usize> {
        let mut ids = BTreeSet::new();
        for handler in &self.handlers {
            collect_response_environment_ids(&handler.response, &mut ids);
            if let Some(authorization) = &handler.basic_authorization {
                collect_response_environment_ids(&authorization.rejected.response, &mut ids);
            }
            if let Some(authorization) = &handler.session_authorization {
                collect_response_environment_ids(&authorization.rejected.response, &mut ids);
            }
            if let Some(limit) = &handler.body_limit {
                collect_response_environment_ids(&limit.rejected.response, &mut ids);
            }
            if let Some(entity_tag) = &handler.entity_tag {
                collect_response_environment_ids(&entity_tag.not_modified.response, &mut ids);
            }
            if let Some(existence) = &handler.sqlite_existence {
                collect_response_environment_ids(&existence.missing.response, &mut ids);
            }
            for validation in &handler.parameter_validations {
                collect_response_environment_ids(&validation.rejected.response, &mut ids);
            }
        }
        ids.into_iter().collect()
    }

    pub fn uses_openai_transport(&self) -> bool {
        self.handlers.iter().any(|handler| {
            response_uses_openai(&handler.response)
                || handler
                    .basic_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_openai(&guard.rejected.response))
                || handler
                    .session_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_openai(&guard.rejected.response))
                || handler
                    .body_limit
                    .as_ref()
                    .is_some_and(|guard| response_uses_openai(&guard.rejected.response))
                || handler
                    .entity_tag
                    .as_ref()
                    .is_some_and(|guard| response_uses_openai(&guard.not_modified.response))
                || handler
                    .sqlite_existence
                    .as_ref()
                    .is_some_and(|guard| response_uses_openai(&guard.missing.response))
                || handler
                    .parameter_validations
                    .iter()
                    .any(|guard| response_uses_openai(&guard.rejected.response))
        })
    }

    pub fn uses_network_transport(&self) -> bool {
        self.handlers.iter().any(|handler| {
            response_uses_network(&handler.response)
                || handler
                    .basic_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_network(&guard.rejected.response))
                || handler
                    .session_authorization
                    .as_ref()
                    .is_some_and(|guard| response_uses_network(&guard.rejected.response))
                || handler
                    .body_limit
                    .as_ref()
                    .is_some_and(|guard| response_uses_network(&guard.rejected.response))
                || handler
                    .entity_tag
                    .as_ref()
                    .is_some_and(|guard| response_uses_network(&guard.not_modified.response))
                || handler
                    .sqlite_existence
                    .as_ref()
                    .is_some_and(|guard| response_uses_network(&guard.missing.response))
                || handler
                    .parameter_validations
                    .iter()
                    .any(|guard| response_uses_network(&guard.rejected.response))
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.version != 2 {
            return Err(format!(
                "unsupported HIR version {}; expected 2",
                self.version
            ));
        }
        if !matches!(
            self.target.as_str(),
            "aarch64-apple-darwin"
                | "aarch64-unknown-linux-gnu"
                | "x86_64-apple-darwin"
                | "x86_64-unknown-linux-gnu"
        ) {
            return Err(format!("unsupported HIR target `{}`", self.target));
        }
        if self.environment_variable_ids().len() > 64 {
            return Err("HIR may reference at most 64 environment variables".to_owned());
        }
        if self.handlers.is_empty()
            || self.handlers.iter().any(|handler| {
                !matches!(
                    handler.method.as_str(),
                    "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS"
                )
            })
        {
            return Err(
                "HIR must contain at least one GET/POST/PUT/DELETE/OPTIONS handler and no other methods"
                    .to_owned(),
            );
        }
        let mut handler_paths = HashSet::new();
        for handler in &self.handlers {
            if !handler.path.starts_with('/') || handler.path.contains('?') {
                return Err("GET handler path must be an absolute path without a query".to_owned());
            }
            validate_route_pattern(&handler.path)?;
            if !handler_paths.insert((handler.method.as_str(), handler.path.as_str())) {
                return Err(format!(
                    "duplicate {} handler path `{}`",
                    handler.method, handler.path
                ));
            }
            validate_response_headers(&handler.headers, &handler.elapsed_headers)?;
            self.validate_stderr(&handler.stderr)?;
            self.validate_handler_response(&handler.response, &handler.path)?;
            for action in &handler.actor_actions {
                let actor = match action {
                    ActorAction::Tell { actor, .. } | ActorAction::Stop { actor } => actor,
                };
                if *actor >= self.actors.len() {
                    return Err("handler actor action references a missing actor".to_owned());
                }
                if let ActorAction::Tell {
                    message,
                    json_message,
                    ..
                } = action
                {
                    self.validate_actor_message(*actor, *message, *json_message)?;
                }
            }
            if handler.sqlite_actions.len() > 16 {
                return Err("handler contains more than sixteen SQLite actions".to_owned());
            }
            for (action_index, action) in handler.sqlite_actions.iter().enumerate() {
                let database = match action {
                    SqliteAction::Exec {
                        database,
                        sql,
                        parameters,
                        result,
                    } => {
                        if *sql >= self.static_strings.len() {
                            return Err("SQLite action references a missing SQL string".to_owned());
                        }
                        self.validate_sqlite_parameters(parameters, &handler.path)?;
                        if result.is_some_and(|result| result != action_index) {
                            return Err("SQLite result slot does not match its action".to_owned());
                        }
                        database
                    }
                    SqliteAction::Transaction { database, sql } => {
                        if *sql >= self.static_strings.len() {
                            return Err(
                                "SQLite transaction references a missing SQL string".to_owned()
                            );
                        }
                        database
                    }
                    SqliteAction::TransactionSteps { database, steps } => {
                        validate_sqlite_transaction_limits(steps, &self.static_strings)?;
                        for step in steps {
                            self.validate_sqlite_parameters(&step.parameters, &handler.path)?;
                        }
                        database
                    }
                    SqliteAction::Close { database } => database,
                };
                if *database >= self.sqlite_databases.len() {
                    return Err("handler SQLite action references a missing database".to_owned());
                }
            }
            for response in handler_responses(handler) {
                validate_sqlite_result_response(response, &handler.sqlite_actions)?;
            }
            if let Some(authorization) = &handler.basic_authorization {
                if authorization.credentials.is_empty() {
                    return Err("Basic Authorization guard has no credentials".to_owned());
                }
                validate_response_headers(&authorization.rejected.headers, &[])?;
                self.validate_stderr(&authorization.rejected.stderr)?;
                self.validate_handler_response(&authorization.rejected.response, &handler.path)?;
            }
            if let Some(authorization) = &handler.session_authorization {
                let Some(cookie) = self.static_strings.get(authorization.cookie) else {
                    return Err(
                        "session authorization references a missing cookie string".to_owned()
                    );
                };
                if !matches!(authorization.mode.as_str(), "local" | "remote")
                    || cookie.value.is_empty()
                    || cookie.value.len() > 128
                    || !cookie.value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(
                                byte,
                                b'_' | b'!'
                                    | b'#'
                                    | b'$'
                                    | b'%'
                                    | b'&'
                                    | b'\''
                                    | b'*'
                                    | b'.'
                                    | b'^'
                                    | b'`'
                                    | b'|'
                                    | b'~'
                                    | b'+'
                                    | b'-'
                            )
                    })
                {
                    return Err("session authorization is outside its bounded contract".to_owned());
                }
                validate_response_headers(&authorization.rejected.headers, &[])?;
                self.validate_stderr(&authorization.rejected.stderr)?;
                self.validate_handler_response(&authorization.rejected.response, &handler.path)?;
            }
            if let Some(request_id) = &handler.request_id {
                let Some(header) = self.static_strings.get(request_id.header) else {
                    return Err("request ID references a missing header string".to_owned());
                };
                if header.value.is_empty()
                    || header.value.len() > 128
                    || !valid_header_name(header.value.as_bytes())
                    || request_id.max_length == 0
                    || request_id.max_length > 1024
                {
                    return Err(
                        "request ID configuration is outside its bounded contract".to_owned()
                    );
                }
            }
            for response in handler_responses(handler) {
                validate_request_id_response(response, handler.request_id.as_ref())?;
            }
            if let Some(limit) = &handler.body_limit {
                if limit.max_bytes > 64 * 1024 {
                    return Err("request body limit exceeds 64 KiB".to_owned());
                }
                validate_response_headers(&limit.rejected.headers, &[])?;
                self.validate_stderr(&limit.rejected.stderr)?;
                self.validate_handler_response(&limit.rejected.response, &handler.path)?;
            }
            if let Some(entity_tag) = &handler.entity_tag {
                if entity_tag.value.is_empty() {
                    return Err("entity tag must not be empty".to_owned());
                }
                validate_response_headers(&entity_tag.not_modified.headers, &[])?;
                self.validate_stderr(&entity_tag.not_modified.stderr)?;
                self.validate_handler_response(&entity_tag.not_modified.response, &handler.path)?;
            }
            if let Some(existence) = &handler.sqlite_existence {
                if existence.database >= self.sqlite_databases.len() {
                    return Err("SQLite existence guard references a missing database".to_owned());
                }
                if existence.sql >= self.static_strings.len() {
                    return Err("SQLite existence guard references a missing SQL string".to_owned());
                }
                self.validate_sqlite_parameters(&existence.parameters, &handler.path)?;
                validate_response_headers(&existence.missing.headers, &[])?;
                self.validate_stderr(&existence.missing.stderr)?;
                self.validate_handler_response(&existence.missing.response, &handler.path)?;
            }
            for validation in &handler.parameter_validations {
                if validation.min_length == 0 {
                    return Err(
                        "path parameter minimum length must be greater than zero".to_owned()
                    );
                }
                let segments: Vec<&str> = handler
                    .path
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .collect();
                if segments
                    .get(validation.segment)
                    .and_then(|segment| route_parameter_name(segment))
                    != Some(validation.name.as_str())
                {
                    return Err(format!(
                        "validated route parameter `{}` does not match segment {} of `{}`",
                        validation.name, validation.segment, handler.path
                    ));
                }
                validate_response_headers(&validation.rejected.headers, &[])?;
                self.validate_stderr(&validation.rejected.stderr)?;
                self.validate_handler_response(&validation.rejected.response, &handler.path)?;
            }
            self.validate_handler_request_json_paths(handler)?;
        }
        for (index, component) in self.components.iter().enumerate() {
            if component.id != index {
                return Err(format!("component id {} is not canonical", component.id));
            }
            for op in &component.html {
                match op {
                    HtmlOp::WriteStatic { string, .. } if *string >= self.static_strings.len() => {
                        return Err(format!(
                            "component {} references a missing string",
                            component.name
                        ));
                    }
                    HtmlOp::CallComponent { component, .. }
                        if *component >= self.components.len() =>
                    {
                        return Err(format!("component {} calls a missing component", component));
                    }
                    _ => {}
                }
            }
        }
        for (index, string) in self.static_strings.iter().enumerate() {
            if string.id != index {
                return Err(format!("static string id {} is not canonical", string.id));
            }
        }
        if self.statistics.functions != self.functions.len() {
            return Err("HIR function statistic does not match the function table".to_owned());
        }
        for (index, function) in self.functions.iter().enumerate() {
            if function.id != index {
                return Err(format!("function id {} is not canonical", function.id));
            }
            if function.parameters.len() > 4
                || !matches!(function.result.as_str(), "string" | "number" | "boolean")
            {
                return Err(format!(
                    "function {} must have at most four scalar parameters and return a scalar",
                    function.name
                ));
            }
            let mut parameter_names = HashSet::new();
            for parameter in &function.parameters {
                if !matches!(
                    parameter.value_type.as_str(),
                    "string" | "number" | "boolean"
                ) || !parameter_names.insert(&parameter.name)
                {
                    return Err(format!(
                        "function {} has invalid or duplicate parameters",
                        function.name
                    ));
                }
            }
            self.validate_expression(&function.body, function.parameters.len())?;
            let body_type = self.function_expression_type(
                &function.body,
                &function.parameters,
                Some("string"),
            )?;
            if body_type != function.result {
                return Err(format!(
                    "function {} body type `{body_type}` does not match result `{}`",
                    function.name, function.result
                ));
            }
        }
        if self.statistics.constants != self.constants.len() {
            return Err("HIR constant statistic does not match the constant pool".to_owned());
        }
        let modules: HashSet<&str> = self
            .modules
            .iter()
            .map(|module| module.path.as_str())
            .collect();
        validate_memory_report(&self.memory, &modules)?;
        for (index, worker) in self.workers.iter().enumerate() {
            if worker.id != index {
                return Err(format!("worker id {} is not canonical", worker.id));
            }
            if !modules.contains(worker.module.as_str()) {
                return Err(format!("worker {index} references a missing module"));
            }
        }
        validate_actor_supervision(&self.supervisors, &self.actors)?;
        for (index, actor) in self.actors.iter().enumerate() {
            if actor.id != index {
                return Err(format!("actor id {} is not canonical", actor.id));
            }
            if actor.mailbox_capacity == 0 || actor.mailbox_capacity > 64 {
                return Err(format!("actor {index} mailbox capacity is outside 1..=64"));
            }
            match actor.operation {
                ActorOperation::Counter
                    if actor.initial_json.is_some()
                        || actor.failure_message.is_some()
                        || actor.restart.is_some()
                        || actor.supervisor.is_some() =>
                {
                    return Err(format!(
                        "counter actor {index} has fallible/JSON configuration"
                    ));
                }
                ActorOperation::FallibleCounter => {
                    if actor.initial_json.is_some()
                        || actor.failure_message.is_none()
                        || actor.persistence.is_some()
                    {
                        return Err(format!(
                            "fallible counter actor {index} has invalid restart configuration"
                        ));
                    }
                    match (&actor.restart, actor.supervisor) {
                        (Some(restart), None)
                            if restart.max_restarts > 0
                                && restart.max_restarts <= 16
                                && restart.within_ms > 0
                                && restart.within_ms <= 60_000 => {}
                        (None, Some(supervisor)) if supervisor < self.supervisors.len() => {}
                        _ => {
                            return Err(format!(
                                "fallible counter actor {index} has invalid restart configuration"
                            ));
                        }
                    }
                }
                ActorOperation::JsonMailbox => {
                    let Some(initial) = actor
                        .initial_json
                        .and_then(|initial| self.static_strings.get(initial))
                    else {
                        return Err(format!("JSON actor {index} has no initial state"));
                    };
                    validate_actor_json(&initial.value)
                        .map_err(|error| format!("JSON actor {index} initial state {error}"))?;
                    if actor.persistence.is_some() {
                        return Err(format!("JSON actor {index} cannot use counter persistence"));
                    }
                    if actor.failure_message.is_some()
                        || actor.restart.is_some()
                        || actor.supervisor.is_some()
                    {
                        return Err(format!("JSON actor {index} has restart configuration"));
                    }
                }
                ActorOperation::Counter => {}
            }
            if let Some(persistence) = &actor.persistence {
                if persistence.database >= self.sqlite_databases.len() {
                    return Err(format!(
                        "actor {index} persistence references a missing database"
                    ));
                }
                if persistence.key.is_empty() || persistence.key.len() > 128 {
                    return Err(format!(
                        "actor {index} persistence key is outside 1..=128 bytes"
                    ));
                }
            }
        }
        for (index, database) in self.sqlite_databases.iter().enumerate() {
            if database.id != index {
                return Err(format!(
                    "SQLite database id {} is not canonical",
                    database.id
                ));
            }
            let valid_static = !database.readonly
                && database.binding.is_none()
                && database.path.as_ref().is_some_and(|path| {
                    !path.is_empty() && path.len() <= 4096 && !path.contains('\0')
                });
            let valid_readonly = database.readonly
                && database.path.is_none()
                && database.binding.as_ref().is_some_and(|binding| {
                    !binding.is_empty()
                        && binding.len() <= 128
                        && binding.is_ascii()
                        && !binding.as_bytes()[0].is_ascii_digit()
                        && binding
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                });
            if !valid_static && !valid_readonly {
                return Err(format!(
                    "SQLite database {index} configuration is outside the bounded contract"
                ));
            }
        }
        for (index, store) in self.asset_stores.iter().enumerate() {
            let valid_name = !store.name.is_empty()
                && store.name.len() <= 128
                && store.name.is_ascii()
                && !store.name.as_bytes()[0].is_ascii_digit()
                && store
                    .name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
            let valid_index = !store.index.is_empty()
                && store.index.len() <= 256
                && !store.index.starts_with('/')
                && store
                    .index
                    .split('/')
                    .all(|part| !part.is_empty() && part != "." && part != "..");
            if store.id != index || !valid_name || !valid_index {
                return Err(format!("asset store {index} is outside the bounded contract"));
            }
        }
        for (index, constant) in self.constants.iter().enumerate() {
            if constant.id != index {
                return Err(format!("constant id {} is not canonical", constant.id));
            }
            if !modules.contains(constant.module.as_str()) {
                return Err(format!(
                    "constant {} references a missing module",
                    constant.name
                ));
            }
            validate_constant_value(&constant.value, 0)?;
        }
        for function in &self.functions {
            if !modules.contains(function.module.as_str()) {
                return Err(format!(
                    "function {} references a missing module",
                    function.name
                ));
            }
        }
        self.validate_function_cycles()?;
        self.validate_handler_exceptions()?;
        Ok(())
    }

    fn validate_expression(
        &self,
        expression: &ValueExpression,
        parameter_count: usize,
    ) -> Result<(), String> {
        self.validate_expression_context(expression, parameter_count, false)
    }

    fn validate_expression_context(
        &self,
        expression: &ValueExpression,
        parameter_count: usize,
        caught_exception_available: bool,
    ) -> Result<(), String> {
        match expression {
            ValueExpression::StringLiteral { string, .. } => {
                if *string >= self.static_strings.len() {
                    return Err("expression references a missing static string".to_owned());
                }
            }
            ValueExpression::NumericLiteral { .. } => {}
            ValueExpression::BooleanLiteral { .. } => {}
            ValueExpression::Constant { constant, .. } => {
                let Some(constant) = self.constants.get(*constant) else {
                    return Err("expression references a missing constant".to_owned());
                };
                if !matches!(constant.value, ConstantValue::String { .. })
                    && !matches!(constant.value, ConstantValue::Boolean { .. })
                    && !matches!(constant.value, ConstantValue::Number { value }
                        if value.is_finite()
                            && value.fract() == 0.0
                            && value >= i64::MIN as f64
                            && value <= i64::MAX as f64)
                {
                    return Err("scalar expression references a non-scalar constant".to_owned());
                }
            }
            ValueExpression::Parameter { parameter, .. } => {
                if *parameter >= parameter_count {
                    return Err("expression references a missing parameter".to_owned());
                }
            }
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                if *function >= self.functions.len() {
                    return Err("expression calls a missing function".to_owned());
                }
                if arguments.len() != self.functions[*function].parameters.len() {
                    return Err("direct call argument count does not match its function".to_owned());
                }
                for argument in arguments {
                    self.validate_expression_context(
                        argument,
                        parameter_count,
                        caught_exception_available,
                    )?;
                }
            }
            ValueExpression::StringEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.validate_expression_context(
                    left,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    right,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_not_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
            }
            ValueExpression::NumericBinary { left, right, .. } => {
                self.validate_expression_context(
                    left,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    right,
                    parameter_count,
                    caught_exception_available,
                )?;
            }
            ValueExpression::NumericEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.validate_expression_context(
                    left,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    right,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_not_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
            }
            ValueExpression::BooleanEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.validate_expression_context(
                    left,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    right,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(
                    when_not_equal,
                    parameter_count,
                    caught_exception_available,
                )?;
            }
            ValueExpression::NumericForLoop {
                accumulator_initial,
                index_initial,
                end_exclusive,
                accumulator_step,
                ..
            } => validate_numeric_for_loop(
                *accumulator_initial,
                *index_initial,
                *end_exclusive,
                *accumulator_step,
            )?,
            ValueExpression::ThrowValue { value, .. } => {
                self.validate_expression_context(
                    value,
                    parameter_count,
                    caught_exception_available,
                )?;
            }
            ValueExpression::TryCatch {
                try_value,
                catch_value,
                ..
            } => {
                self.validate_expression_context(
                    try_value,
                    parameter_count,
                    caught_exception_available,
                )?;
                self.validate_expression_context(catch_value, parameter_count, true)?;
            }
            ValueExpression::CaughtException { .. } => {
                if !caught_exception_available {
                    return Err("caught exception value is outside a catch expression".to_owned());
                }
            }
            ValueExpression::Concat { .. }
            | ValueExpression::RouteParameter { .. }
            | ValueExpression::RequestHeader { .. }
            | ValueExpression::RequestJsonField { .. }
            | ValueExpression::RequestId { .. }
            | ValueExpression::SqliteRunChanges { .. }
            | ValueExpression::SqliteRunLastInsertRowId { .. }
            | ValueExpression::RequestCookie { .. }
            | ValueExpression::EnvironmentVariable { .. }
            | ValueExpression::FileText { .. }
            | ValueExpression::ActorCall { .. }
            | ValueExpression::SqliteQuery { .. }
            | ValueExpression::TodoStore { .. }
            | ValueExpression::FetchStatus { .. }
            | ValueExpression::QueryParameter { .. }
            | ValueExpression::QueryConditional { .. }
            | ValueExpression::WorkerCall { .. }
            | ValueExpression::OpenAiChatText { .. } => {
                return Err(
                    "request-time expressions are only valid in handler responses".to_owned(),
                );
            }
        }
        Ok(())
    }

    fn function_expression_type(
        &self,
        expression: &ValueExpression,
        parameters: &[FunctionParameter],
        caught_type: Option<&str>,
    ) -> Result<String, String> {
        match expression {
            ValueExpression::StringLiteral { .. } => Ok("string".to_owned()),
            ValueExpression::NumericLiteral { .. } => Ok("number".to_owned()),
            ValueExpression::BooleanLiteral { .. } => Ok("boolean".to_owned()),
            ValueExpression::NumericForLoop { .. } => Ok("number".to_owned()),
            ValueExpression::Constant { constant, .. } => match self.constants[*constant].value {
                ConstantValue::String { .. } => Ok("string".to_owned()),
                ConstantValue::Number { value }
                    if value.is_finite()
                        && value.fract() == 0.0
                        && value >= i64::MIN as f64
                        && value <= i64::MAX as f64 =>
                {
                    Ok("number".to_owned())
                }
                ConstantValue::Boolean { .. } => Ok("boolean".to_owned()),
                _ => Err("native scalar expression references a non-scalar constant".to_owned()),
            },
            ValueExpression::Parameter { parameter, .. } => parameters
                .get(*parameter)
                .map(|parameter| parameter.value_type.clone())
                .ok_or_else(|| "expression references a missing typed parameter".to_owned()),
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                let target = &self.functions[*function];
                for (argument, parameter) in arguments.iter().zip(&target.parameters) {
                    let argument_type =
                        self.function_expression_type(argument, parameters, caught_type)?;
                    if argument_type != parameter.value_type {
                        return Err(format!(
                            "direct call argument type `{argument_type}` does not match `{}`",
                            parameter.value_type
                        ));
                    }
                }
                Ok(target.result.clone())
            }
            ValueExpression::StringEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.require_expression_type(left, parameters, caught_type, "string")?;
                self.require_expression_type(right, parameters, caught_type, "string")?;
                self.same_branch_type(when_equal, when_not_equal, parameters, caught_type)
            }
            ValueExpression::NumericBinary { left, right, .. } => {
                self.require_expression_type(left, parameters, caught_type, "number")?;
                self.require_expression_type(right, parameters, caught_type, "number")?;
                Ok("number".to_owned())
            }
            ValueExpression::NumericEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.require_expression_type(left, parameters, caught_type, "number")?;
                self.require_expression_type(right, parameters, caught_type, "number")?;
                self.same_branch_type(when_equal, when_not_equal, parameters, caught_type)
            }
            ValueExpression::BooleanEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.require_expression_type(left, parameters, caught_type, "boolean")?;
                self.require_expression_type(right, parameters, caught_type, "boolean")?;
                self.same_branch_type(when_equal, when_not_equal, parameters, caught_type)
            }
            ValueExpression::ThrowValue { value, .. } => {
                self.require_expression_type(value, parameters, caught_type, "string")?;
                Ok("string".to_owned())
            }
            ValueExpression::TryCatch {
                try_value,
                catch_value,
                ..
            } => {
                let try_type = self.function_expression_type(try_value, parameters, caught_type)?;
                let catch_type =
                    self.function_expression_type(catch_value, parameters, Some("string"))?;
                if try_type != catch_type {
                    return Err("native try/catch branches must have the same type".to_owned());
                }
                Ok(try_type)
            }
            ValueExpression::CaughtException { .. } => caught_type
                .map(str::to_owned)
                .ok_or_else(|| "caught exception has no type context".to_owned()),
            ValueExpression::Concat { values, .. } => {
                for value in values {
                    self.require_expression_type(value, parameters, caught_type, "string")?;
                }
                Ok("string".to_owned())
            }
            ValueExpression::QueryConditional {
                when_present,
                when_absent,
                ..
            } => self.same_branch_type(when_present, when_absent, parameters, caught_type),
            ValueExpression::WorkerCall { input, .. } => {
                self.require_expression_type(input, parameters, caught_type, "string")?;
                Ok("string".to_owned())
            }
            ValueExpression::RouteParameter { .. }
            | ValueExpression::RequestHeader { .. }
            | ValueExpression::RequestJsonField { .. }
            | ValueExpression::RequestId { .. }
            | ValueExpression::SqliteRunChanges { .. }
            | ValueExpression::SqliteRunLastInsertRowId { .. }
            | ValueExpression::RequestCookie { .. }
            | ValueExpression::EnvironmentVariable { .. }
            | ValueExpression::FileText { .. }
            | ValueExpression::ActorCall { .. }
            | ValueExpression::SqliteQuery { .. }
            | ValueExpression::TodoStore { .. }
            | ValueExpression::FetchStatus { .. }
            | ValueExpression::QueryParameter { .. }
            | ValueExpression::OpenAiChatText { .. } => Ok("string".to_owned()),
        }
    }

    fn require_expression_type(
        &self,
        expression: &ValueExpression,
        parameters: &[FunctionParameter],
        caught_type: Option<&str>,
        expected: &str,
    ) -> Result<(), String> {
        let actual = self.function_expression_type(expression, parameters, caught_type)?;
        if actual == expected {
            Ok(())
        } else {
            Err(format!(
                "native expression type `{actual}` does not match `{expected}`"
            ))
        }
    }

    fn same_branch_type(
        &self,
        left: &ValueExpression,
        right: &ValueExpression,
        parameters: &[FunctionParameter],
        caught_type: Option<&str>,
    ) -> Result<String, String> {
        let left_type = self.function_expression_type(left, parameters, caught_type)?;
        let right_type = self.function_expression_type(right, parameters, caught_type)?;
        if left_type == right_type {
            Ok(left_type)
        } else {
            Err("native conditional branches must have the same type".to_owned())
        }
    }

    fn validate_stderr(&self, stderr: &[usize]) -> Result<(), String> {
        if stderr
            .iter()
            .any(|string| *string >= self.static_strings.len())
        {
            return Err("handler stderr references a missing static string".to_owned());
        }
        Ok(())
    }

    fn validate_actor_message(
        &self,
        actor: usize,
        message: Option<i64>,
        json_message: Option<usize>,
    ) -> Result<(), String> {
        let Some(actor) = self.actors.get(actor) else {
            return Err("actor message references a missing actor".to_owned());
        };
        match actor.operation {
            ActorOperation::Counter | ActorOperation::FallibleCounter
                if message.is_some() && json_message.is_none() =>
            {
                Ok(())
            }
            ActorOperation::JsonMailbox if message.is_none() => {
                let Some(message) =
                    json_message.and_then(|message| self.static_strings.get(message))
                else {
                    return Err("JSON actor message references a missing static string".to_owned());
                };
                validate_actor_json(&message.value)
                    .map_err(|error| format!("JSON actor message {error}"))
            }
            ActorOperation::Counter | ActorOperation::FallibleCounter => {
                Err("counter actor requires one integer message".to_owned())
            }
            ActorOperation::JsonMailbox => {
                Err("JSON actor requires one static JSON message".to_owned())
            }
        }
    }

    fn validate_sqlite_parameters(
        &self,
        parameters: &[SqliteParameter],
        route_pattern: &str,
    ) -> Result<(), String> {
        if parameters.len() > 16 {
            return Err("SQLite operation exceeds the compiled 16-parameter limit".to_owned());
        }
        for parameter in parameters {
            match parameter {
                SqliteParameter::RouteParameter { segment }
                    if !handler_path_has_parameter_segment(route_pattern, *segment) =>
                {
                    return Err("SQLite parameter does not reference a route parameter".to_owned());
                }
                SqliteParameter::RequestJsonField { field }
                    if self
                        .static_strings
                        .get(*field)
                        .is_none_or(|field| !valid_request_json_path(&field.value)) =>
                {
                    return Err("SQLite JSON parameter has an invalid field path".to_owned());
                }
                SqliteParameter::RequestHeader { header }
                    if self.static_strings.get(*header).is_none_or(|header| {
                        header.value.is_empty()
                            || header.value.len() > 128
                            || !header.value.bytes().all(|byte| {
                                byte.is_ascii_alphanumeric()
                                    || matches!(
                                        byte,
                                        b'!' | b'#'
                                            | b'$'
                                            | b'%'
                                            | b'&'
                                            | b'\''
                                            | b'*'
                                            | b'+'
                                            | b'-'
                                            | b'.'
                                            | b'^'
                                            | b'_'
                                            | b'`'
                                            | b'|'
                                            | b'~'
                                    )
                            })
                    }) =>
                {
                    return Err("SQLite request-header parameter has an invalid name".to_owned());
                }
                SqliteParameter::RandomUuid => {}
                SqliteParameter::StaticString { string }
                    if self
                        .static_strings
                        .get(*string)
                        .is_none_or(|value| value.value.len() > 65_536) =>
                {
                    return Err("SQLite static string parameter is invalid".to_owned());
                }
                SqliteParameter::StaticInteger { value }
                    if value.unsigned_abs() > 9_007_199_254_740_991 =>
                {
                    return Err(
                        "SQLite static integer parameter is outside the JavaScript safe range"
                            .to_owned(),
                    );
                }
                SqliteParameter::StaticReal { value } if !value.is_finite() => {
                    return Err("SQLite static real parameter must be finite".to_owned());
                }
                SqliteParameter::StaticBoolean { .. }
                | SqliteParameter::Null
                | SqliteParameter::StaticString { .. }
                | SqliteParameter::StaticInteger { .. }
                | SqliteParameter::StaticReal { .. } => {}
                _ => {}
            }
        }
        Ok(())
    }

    fn validate_handler_request_json_paths(&self, handler: &Handler) -> Result<(), String> {
        let mut fields = HashSet::new();
        for response in handler_responses(handler) {
            collect_request_json_response_fields(response, &mut fields);
        }
        if let Some(existence) = &handler.sqlite_existence {
            collect_request_json_parameter_fields(&existence.parameters, &mut fields);
        }
        for action in &handler.sqlite_actions {
            match action {
                SqliteAction::Exec { parameters, .. } => {
                    collect_request_json_parameter_fields(parameters, &mut fields);
                }
                SqliteAction::TransactionSteps { steps, .. } => {
                    for step in steps {
                        collect_request_json_parameter_fields(&step.parameters, &mut fields);
                    }
                }
                SqliteAction::Transaction { .. } | SqliteAction::Close { .. } => {}
            }
        }
        validate_request_json_path_fields(&fields, &self.static_strings)
    }

    fn validate_handler_response(
        &self,
        response: &HandlerResponse,
        route_pattern: &str,
    ) -> Result<(), String> {
        match response {
            HandlerResponse::Html { component } if *component >= self.components.len() => {
                Err("GET handler references a missing component".to_owned())
            }
            HandlerResponse::Asset { store } if *store >= self.asset_stores.len() => {
                Err("handler references a missing asset store".to_owned())
            }
            HandlerResponse::Text {
                value,
                status,
                content_type,
            } => {
                if !(100..=599).contains(status) {
                    return Err("handler response has an invalid HTTP status".to_owned());
                }
                if content_type.as_deref().is_some_and(|value| {
                    !matches!(
                        value,
                        "" | "text/plain; charset=UTF-8"
                            | "text/plain; charset=utf-8"
                            | "text/plain;charset=UTF-8"
                            | "text/html; charset=UTF-8"
                            | "application/json"
                    )
                }) {
                    return Err("GET text response has an unsupported content type".to_owned());
                }
                self.validate_handler_expression(value, route_pattern)?;
                self.require_expression_type(value, &[], None, "string")
            }
            HandlerResponse::Stream {
                chunks,
                status,
                content_type,
            } => {
                if !(100..=599).contains(status) {
                    return Err("stream response has an invalid HTTP status".to_owned());
                }
                if chunks.is_empty() || chunks.len() > 16 {
                    return Err("stream response must contain between 1 and 16 chunks".to_owned());
                }
                if content_type.as_deref().is_some_and(|value| {
                    !matches!(
                        value,
                        "" | "text/plain; charset=UTF-8"
                            | "text/plain; charset=utf-8"
                            | "text/plain;charset=UTF-8"
                            | "text/html; charset=UTF-8"
                            | "application/json"
                    )
                }) {
                    return Err("stream response has an unsupported content type".to_owned());
                }
                for chunk in chunks {
                    self.validate_handler_expression(chunk, route_pattern)?;
                    self.require_expression_type(chunk, &[], None, "string")?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    fn validate_handler_expression(
        &self,
        expression: &ValueExpression,
        route_pattern: &str,
    ) -> Result<(), String> {
        match expression {
            ValueExpression::Concat { values, .. } => {
                if values.is_empty() {
                    return Err("handler concatenation must not be empty".to_owned());
                }
                for value in values {
                    self.validate_handler_expression(value, route_pattern)?;
                }
                Ok(())
            }
            ValueExpression::RouteParameter {
                name,
                segment,
                tail,
                ..
            } => {
                let segments: Vec<&str> = route_pattern
                    .split('/')
                    .filter(|part| !part.is_empty())
                    .collect();
                let route_segment = segments.get(*segment).copied();
                if route_segment.and_then(route_parameter_name) != Some(name.as_str()) {
                    return Err(format!(
                        "route parameter `{name}` does not match segment {segment} of `{route_pattern}`"
                    ));
                }
                if route_segment.is_some_and(|segment| segment.ends_with("{.*}")) != *tail {
                    return Err(format!(
                        "route parameter `{name}` has inconsistent multi-segment metadata"
                    ));
                }
                Ok(())
            }
            ValueExpression::RequestHeader { header, .. } => {
                let Some(header) = self.static_strings.get(*header) else {
                    return Err("request header references a missing static string".to_owned());
                };
                if header.value.is_empty() {
                    return Err("request header name must not be empty".to_owned());
                }
                Ok(())
            }
            ValueExpression::RequestJsonField { field, .. } => {
                let Some(field) = self.static_strings.get(*field) else {
                    return Err("request JSON field references a missing static string".to_owned());
                };
                if !valid_request_json_path(&field.value) {
                    return Err("request JSON field path is outside the native limit".to_owned());
                }
                Ok(())
            }
            ValueExpression::RequestId { header, .. } => {
                let Some(header) = self.static_strings.get(*header) else {
                    return Err("request ID references a missing header string".to_owned());
                };
                if header.value.is_empty() {
                    return Err("request ID header name must not be empty".to_owned());
                }
                Ok(())
            }
            ValueExpression::SqliteRunChanges { .. }
            | ValueExpression::SqliteRunLastInsertRowId { .. } => Ok(()),
            ValueExpression::RequestCookie {
                cookie, fallback, ..
            } => {
                let Some(cookie) = self.static_strings.get(*cookie) else {
                    return Err("request cookie references a missing static string".to_owned());
                };
                if cookie.value.is_empty()
                    || cookie.value.len() > 128
                    || !cookie.value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(
                                byte,
                                b'_' | b'!'
                                    | b'#'
                                    | b'$'
                                    | b'%'
                                    | b'&'
                                    | b'\''
                                    | b'*'
                                    | b'.'
                                    | b'^'
                                    | b'`'
                                    | b'|'
                                    | b'~'
                                    | b'+'
                                    | b'-'
                            )
                    })
                {
                    return Err("request cookie name is invalid".to_owned());
                }
                if fallback.is_some_and(|fallback| fallback >= self.static_strings.len()) {
                    return Err(
                        "request cookie fallback references a missing static string".to_owned()
                    );
                }
                Ok(())
            }
            ValueExpression::EnvironmentVariable {
                name,
                required,
                fallback,
                ..
            } => {
                let Some(name) = self.static_strings.get(*name) else {
                    return Err(
                        "environment variable references a missing static string".to_owned()
                    );
                };
                if name.value.is_empty()
                    || name.value.len() > 128
                    || !name.value.is_ascii()
                    || name.value.as_bytes()[0].is_ascii_digit()
                    || !name
                        .value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                {
                    return Err("environment variable has a non-portable name".to_owned());
                }
                if *required && fallback.is_some() {
                    return Err("required environment access cannot have a fallback".to_owned());
                }
                if fallback.is_some_and(|fallback| fallback >= self.static_strings.len()) {
                    return Err(
                        "environment fallback references a missing static string".to_owned()
                    );
                }
                Ok(())
            }
            ValueExpression::FileText {
                path, max_bytes, ..
            } => {
                let Some(path) = self.static_strings.get(*path) else {
                    return Err("file read references a missing static string".to_owned());
                };
                if path.value.is_empty()
                    || path.value.len() > 4096
                    || path.value.starts_with('/')
                    || path.value.split(['/', '\\']).any(|component| {
                        component.is_empty() || component == "." || component == ".."
                    })
                {
                    return Err("file read path is not a normalized relative path".to_owned());
                }
                if *max_bytes == 0 || *max_bytes > 1_048_576 {
                    return Err("file read maxBytes is outside the native limit".to_owned());
                }
                Ok(())
            }
            ValueExpression::ActorCall {
                actor,
                message,
                json_message,
                timeout_ms,
                ..
            } => {
                if *actor >= self.actors.len() {
                    return Err("actor call references a missing actor".to_owned());
                }
                self.validate_actor_message(*actor, *message, *json_message)?;
                if timeout_ms.is_some_and(|timeout| timeout == 0 || timeout > 60_000) {
                    return Err("actor ask timeoutMs is outside the native limit".to_owned());
                }
                Ok(())
            }
            ValueExpression::SqliteQuery {
                database,
                sql,
                parameters,
                ..
            } => {
                if *database >= self.sqlite_databases.len() {
                    return Err("SQLite query references a missing database".to_owned());
                }
                let Some(sql) = self.static_strings.get(*sql) else {
                    return Err("SQLite query references a missing SQL string".to_owned());
                };
                if sql.value.len() > 65_536 {
                    return Err("SQLite query exceeds the native SQL limit".to_owned());
                }
                self.validate_sqlite_parameters(parameters, route_pattern)?;
                Ok(())
            }
            ValueExpression::TodoStore {
                database,
                operation,
                user,
                argument,
                ..
            } => {
                if *database >= self.sqlite_databases.len() {
                    return Err("TODO store references a missing SQLite database".to_owned());
                }
                match user {
                    TodoUser::StaticString { string } => {
                        let Some(user) = self.static_strings.get(*string) else {
                            return Err("TODO store user references a missing string".to_owned());
                        };
                        if user.value.is_empty() || user.value.len() > 1024 {
                            return Err(
                                "TODO store user is outside the bounded contract".to_owned()
                            );
                        }
                    }
                    TodoUser::RequestCookie { cookie } => {
                        let Some(cookie) = self.static_strings.get(*cookie) else {
                            return Err("TODO store cookie references a missing string".to_owned());
                        };
                        if cookie.value.is_empty() || cookie.value.len() > 128 {
                            return Err(
                                "TODO store cookie is outside the bounded contract".to_owned()
                            );
                        }
                    }
                }
                match (operation, argument) {
                    (TodoOperation::List, None) => {}
                    (TodoOperation::Add, Some(TodoArgument::RequestJsonField { field })) => {
                        let Some(field) = self.static_strings.get(*field) else {
                            return Err("TODO add references a missing JSON field".to_owned());
                        };
                        if !valid_request_json_path(&field.value) {
                            return Err(
                                "TODO add JSON field is outside the native limit".to_owned()
                            );
                        }
                    }
                    (
                        TodoOperation::Complete | TodoOperation::Delete,
                        Some(TodoArgument::RouteParameter { segment }),
                    ) => {
                        let segments = route_pattern
                            .split('/')
                            .filter(|part| !part.is_empty())
                            .collect::<Vec<_>>();
                        if segments
                            .get(*segment)
                            .and_then(|part| route_parameter_name(part))
                            .is_none()
                        {
                            return Err("TODO mutation route parameter is missing".to_owned());
                        }
                    }
                    _ => return Err("TODO store operation has an incompatible argument".to_owned()),
                }
                Ok(())
            }
            ValueExpression::FetchStatus { url, .. } => {
                let Some(url) = self.static_strings.get(*url) else {
                    return Err("fetch URL references a missing static string".to_owned());
                };
                if !url.value.starts_with("https://") {
                    return Err("fetch URL must use HTTPS".to_owned());
                }
                Ok(())
            }
            ValueExpression::QueryParameter {
                query, fallback, ..
            } => {
                let Some(query) = self.static_strings.get(*query) else {
                    return Err("query parameter references a missing static string".to_owned());
                };
                if query.value.is_empty() {
                    return Err("query parameter name must not be empty".to_owned());
                }
                if fallback.is_some_and(|fallback| fallback >= self.static_strings.len()) {
                    return Err(
                        "query parameter fallback references a missing static string".to_owned(),
                    );
                }
                Ok(())
            }
            ValueExpression::QueryConditional {
                query,
                when_present,
                when_absent,
                ..
            } => {
                let Some(query) = self.static_strings.get(*query) else {
                    return Err("query condition references a missing static string".to_owned());
                };
                if query.value.is_empty() {
                    return Err("query condition name must not be empty".to_owned());
                }
                self.validate_handler_expression(when_present, route_pattern)?;
                self.validate_handler_expression(when_absent, route_pattern)
            }
            ValueExpression::WorkerCall { worker, input, .. } => {
                if *worker >= self.workers.len() {
                    return Err("worker call references a missing worker".to_owned());
                }
                if !matches!(
                    input.as_ref(),
                    ValueExpression::StringLiteral { .. } | ValueExpression::QueryParameter { .. }
                ) {
                    return Err(
                        "worker call input must be a string literal or query parameter".to_owned(),
                    );
                }
                self.validate_handler_expression(input, route_pattern)
            }
            ValueExpression::OpenAiChatText {
                url,
                authorization,
                body,
                ..
            } => {
                let Some(url) = self.static_strings.get(*url) else {
                    return Err("OpenAI chat URL references a missing static string".to_owned());
                };
                let Some(authorization) = self.static_strings.get(*authorization) else {
                    return Err(
                        "OpenAI authorization references a missing static string".to_owned()
                    );
                };
                let Some(body) = self.static_strings.get(*body) else {
                    return Err("OpenAI body references a missing static string".to_owned());
                };
                if !valid_provider_url(&url.value) {
                    return Err(
                        "OpenAI chat URL must use HTTPS or a loopback HTTP origin".to_owned()
                    );
                }
                if !authorization.value.starts_with("Bearer ")
                    || authorization.value.len() <= "Bearer ".len()
                    || body.value.is_empty()
                {
                    return Err("OpenAI chat request metadata is invalid".to_owned());
                }
                Ok(())
            }
            _ => self.validate_expression(expression, 0),
        }
    }

    fn validate_function_cycles(&self) -> Result<(), String> {
        let mut state = vec![0_u8; self.functions.len()];
        for function in &self.functions {
            self.visit_function(function.id, &mut state)?;
        }
        Ok(())
    }

    fn visit_function(&self, id: usize, state: &mut [u8]) -> Result<(), String> {
        match state[id] {
            1 => return Err("recursive function graph is not supported".to_owned()),
            2 => return Ok(()),
            _ => state[id] = 1,
        }
        self.visit_expression_functions(&self.functions[id].body, state)?;
        state[id] = 2;
        Ok(())
    }

    fn visit_expression_functions(
        &self,
        expression: &ValueExpression,
        state: &mut [u8],
    ) -> Result<(), String> {
        match expression {
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                self.visit_function(*function, state)?;
                for argument in arguments {
                    self.visit_expression_functions(argument, state)?;
                }
            }
            ValueExpression::Concat { values, .. } => {
                for value in values {
                    self.visit_expression_functions(value, state)?;
                }
            }
            ValueExpression::QueryConditional {
                when_present,
                when_absent,
                ..
            } => {
                self.visit_expression_functions(when_present, state)?;
                self.visit_expression_functions(when_absent, state)?;
            }
            ValueExpression::StringEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.visit_expression_functions(left, state)?;
                self.visit_expression_functions(right, state)?;
                self.visit_expression_functions(when_equal, state)?;
                self.visit_expression_functions(when_not_equal, state)?;
            }
            ValueExpression::BooleanEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.visit_expression_functions(left, state)?;
                self.visit_expression_functions(right, state)?;
                self.visit_expression_functions(when_equal, state)?;
                self.visit_expression_functions(when_not_equal, state)?;
            }
            ValueExpression::NumericBinary { left, right, .. } => {
                self.visit_expression_functions(left, state)?;
                self.visit_expression_functions(right, state)?;
            }
            ValueExpression::NumericEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => {
                self.visit_expression_functions(left, state)?;
                self.visit_expression_functions(right, state)?;
                self.visit_expression_functions(when_equal, state)?;
                self.visit_expression_functions(when_not_equal, state)?;
            }
            ValueExpression::ThrowValue { value, .. } => {
                self.visit_expression_functions(value, state)?;
            }
            ValueExpression::TryCatch {
                try_value,
                catch_value,
                ..
            } => {
                self.visit_expression_functions(try_value, state)?;
                self.visit_expression_functions(catch_value, state)?;
            }
            ValueExpression::WorkerCall { input, .. } => {
                self.visit_expression_functions(input, state)?;
            }
            _ => {}
        }
        Ok(())
    }

    fn validate_handler_exceptions(&self) -> Result<(), String> {
        let mut memo = vec![None; self.functions.len()];
        for handler in &self.handlers {
            for response in handler_responses(handler) {
                if self.response_may_throw(response, &mut memo) {
                    return Err(format!(
                        "handler {} {} may complete with an uncaught native exception",
                        handler.method, handler.path
                    ));
                }
            }
        }
        Ok(())
    }

    fn response_may_throw(&self, response: &HandlerResponse, memo: &mut [Option<bool>]) -> bool {
        match response {
            HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => false,
            HandlerResponse::Text { value, .. } => self.expression_may_throw(value, memo),
            HandlerResponse::Stream { chunks, .. } => chunks
                .iter()
                .any(|chunk| self.expression_may_throw(chunk, memo)),
        }
    }

    fn function_may_throw(&self, id: usize, memo: &mut [Option<bool>]) -> bool {
        if let Some(result) = memo[id] {
            return result;
        }
        let result = self.expression_may_throw(&self.functions[id].body, memo);
        memo[id] = Some(result);
        result
    }

    fn expression_may_throw(
        &self,
        expression: &ValueExpression,
        memo: &mut [Option<bool>],
    ) -> bool {
        match expression {
            ValueExpression::ThrowValue { .. } => true,
            ValueExpression::TryCatch { catch_value, .. } => {
                self.expression_may_throw(catch_value, memo)
            }
            ValueExpression::DirectCall {
                function,
                arguments,
                ..
            } => {
                arguments
                    .iter()
                    .any(|argument| self.expression_may_throw(argument, memo))
                    || self.function_may_throw(*function, memo)
            }
            ValueExpression::StringEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => [left, right, when_equal, when_not_equal]
                .into_iter()
                .any(|value| self.expression_may_throw(value, memo)),
            ValueExpression::BooleanEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => [left, right, when_equal, when_not_equal]
                .into_iter()
                .any(|value| self.expression_may_throw(value, memo)),
            ValueExpression::NumericBinary { left, right, .. } => {
                self.expression_may_throw(left, memo) || self.expression_may_throw(right, memo)
            }
            ValueExpression::NumericEqualConditional {
                left,
                right,
                when_equal,
                when_not_equal,
                ..
            } => [left, right, when_equal, when_not_equal]
                .into_iter()
                .any(|value| self.expression_may_throw(value, memo)),
            ValueExpression::Concat { values, .. } => values
                .iter()
                .any(|value| self.expression_may_throw(value, memo)),
            ValueExpression::QueryConditional {
                when_present,
                when_absent,
                ..
            } => {
                self.expression_may_throw(when_present, memo)
                    || self.expression_may_throw(when_absent, memo)
            }
            ValueExpression::WorkerCall { input, .. } => self.expression_may_throw(input, memo),
            _ => false,
        }
    }
}

fn validate_numeric_for_loop(
    accumulator_initial: i64,
    index_initial: i64,
    end_exclusive: i64,
    accumulator_step: i64,
) -> Result<(), String> {
    const MAX_SAFE_INTEGER: i128 = 9_007_199_254_740_991;
    let Some(iterations) = end_exclusive.checked_sub(index_initial) else {
        return Err("numeric for-loop bounds overflow".to_owned());
    };
    if !(0..=4096).contains(&iterations) {
        return Err("numeric for-loop iterations must be within 0..=4096".to_owned());
    }
    let final_value =
        i128::from(accumulator_initial) + i128::from(accumulator_step) * i128::from(iterations);
    if !(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&final_value) {
        return Err("numeric for-loop result exceeds the safe-integer range".to_owned());
    }
    Ok(())
}

fn handler_responses(handler: &Handler) -> Vec<&HandlerResponse> {
    let mut responses = vec![&handler.response];
    if let Some(authorization) = &handler.basic_authorization {
        responses.push(&authorization.rejected.response);
    }
    if let Some(authorization) = &handler.session_authorization {
        responses.push(&authorization.rejected.response);
    }
    if let Some(limit) = &handler.body_limit {
        responses.push(&limit.rejected.response);
    }
    if let Some(entity_tag) = &handler.entity_tag {
        responses.push(&entity_tag.not_modified.response);
    }
    if let Some(existence) = &handler.sqlite_existence {
        responses.push(&existence.missing.response);
    }
    responses.extend(
        handler
            .parameter_validations
            .iter()
            .map(|validation| &validation.rejected.response),
    );
    responses
}

fn collect_request_json_response_fields(response: &HandlerResponse, output: &mut HashSet<usize>) {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => {}
        HandlerResponse::Text { value, .. } => {
            collect_request_json_expression_fields(value, output);
        }
        HandlerResponse::Stream { chunks, .. } => {
            for chunk in chunks {
                collect_request_json_expression_fields(chunk, output);
            }
        }
    }
}

fn collect_request_json_expression_fields(
    expression: &ValueExpression,
    output: &mut HashSet<usize>,
) {
    match expression {
        ValueExpression::RequestJsonField { field, .. } => {
            output.insert(*field);
        }
        ValueExpression::DirectCall { arguments, .. }
        | ValueExpression::Concat {
            values: arguments, ..
        } => {
            for argument in arguments {
                collect_request_json_expression_fields(argument, output);
            }
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            for value in [left, right, when_equal, when_not_equal] {
                collect_request_json_expression_fields(value, output);
            }
        }
        ValueExpression::NumericBinary { left, right, .. } => {
            collect_request_json_expression_fields(left, output);
            collect_request_json_expression_fields(right, output);
        }
        ValueExpression::ThrowValue { value, .. } => {
            collect_request_json_expression_fields(value, output);
        }
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => {
            collect_request_json_expression_fields(try_value, output);
            collect_request_json_expression_fields(catch_value, output);
        }
        ValueExpression::SqliteQuery { parameters, .. } => {
            collect_request_json_parameter_fields(parameters, output);
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => {
            collect_request_json_expression_fields(when_present, output);
            collect_request_json_expression_fields(when_absent, output);
        }
        ValueExpression::WorkerCall { input, .. } => {
            collect_request_json_expression_fields(input, output);
        }
        _ => {}
    }
}

fn collect_request_json_parameter_fields(
    parameters: &[SqliteParameter],
    output: &mut HashSet<usize>,
) {
    for parameter in parameters {
        if let SqliteParameter::RequestJsonField { field } = parameter {
            output.insert(*field);
        }
    }
}

fn validate_request_json_path_fields(
    fields: &HashSet<usize>,
    static_strings: &[StaticString],
) -> Result<(), String> {
    let mut paths = HashSet::new();
    for field in fields {
        let Some(path) = static_strings.get(*field) else {
            return Err("request JSON field references a missing static string".to_owned());
        };
        if !valid_request_json_path(&path.value) {
            return Err("request JSON field path is outside the native limit".to_owned());
        }
        paths.insert(path.value.as_str());
    }
    if paths.len() > 16 {
        return Err("handler selects more than sixteen request JSON leaf paths".to_owned());
    }
    Ok(())
}

fn validate_request_id_response(
    response: &HandlerResponse,
    request_id: Option<&RequestId>,
) -> Result<(), String> {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => Ok(()),
        HandlerResponse::Text { value, .. } => {
            validate_request_id_expression(value, request_id.map(|config| config.header))
        }
        HandlerResponse::Stream { chunks, .. } => chunks.iter().try_for_each(|chunk| {
            validate_request_id_expression(chunk, request_id.map(|config| config.header))
        }),
    }
}

fn validate_request_id_expression(
    expression: &ValueExpression,
    configured_header: Option<usize>,
) -> Result<(), String> {
    match expression {
        ValueExpression::RequestId { header, .. } => match configured_header {
            None => Err("request ID value requires request ID middleware".to_owned()),
            Some(configured) if configured != *header => {
                Err("request ID value does not match its middleware header".to_owned())
            }
            Some(_) => Ok(()),
        },
        ValueExpression::DirectCall { arguments, .. }
        | ValueExpression::Concat {
            values: arguments, ..
        } => arguments
            .iter()
            .try_for_each(|value| validate_request_id_expression(value, configured_header)),
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            validate_request_id_expression(left, configured_header)?;
            validate_request_id_expression(right, configured_header)?;
            validate_request_id_expression(when_equal, configured_header)?;
            validate_request_id_expression(when_not_equal, configured_header)
        }
        ValueExpression::NumericBinary { left, right, .. } => {
            validate_request_id_expression(left, configured_header)?;
            validate_request_id_expression(right, configured_header)
        }
        ValueExpression::ThrowValue { value, .. } => {
            validate_request_id_expression(value, configured_header)
        }
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => {
            validate_request_id_expression(try_value, configured_header)?;
            validate_request_id_expression(catch_value, configured_header)
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => {
            validate_request_id_expression(when_present, configured_header)?;
            validate_request_id_expression(when_absent, configured_header)
        }
        ValueExpression::WorkerCall { input, .. } => {
            validate_request_id_expression(input, configured_header)
        }
        _ => Ok(()),
    }
}

fn validate_sqlite_result_response(
    response: &HandlerResponse,
    actions: &[SqliteAction],
) -> Result<(), String> {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => Ok(()),
        HandlerResponse::Text { value, .. } => validate_sqlite_result_expression(value, actions),
        HandlerResponse::Stream { chunks, .. } => chunks
            .iter()
            .try_for_each(|chunk| validate_sqlite_result_expression(chunk, actions)),
    }
}

fn validate_sqlite_transaction_limits(
    steps: &[SqliteTransactionStep],
    strings: &[StaticString],
) -> Result<(), String> {
    if steps.is_empty() || steps.len() > 16 {
        return Err("SQLite prepared transaction requires one to sixteen steps".to_owned());
    }
    let mut sql_bytes = 0usize;
    let mut parameter_count = 0usize;
    for step in steps {
        let Some(sql) = strings.get(step.sql) else {
            return Err("SQLite prepared transaction references a missing SQL string".to_owned());
        };
        sql_bytes = sql_bytes
            .checked_add(sql.value.len())
            .filter(|bytes| *bytes <= 65_536)
            .ok_or_else(|| {
                "SQLite prepared transaction exceeds the aggregate SQL limit".to_owned()
            })?;
        parameter_count = parameter_count
            .checked_add(step.parameters.len())
            .filter(|count| *count <= 64)
            .ok_or_else(|| {
                "SQLite prepared transaction exceeds the aggregate parameter limit".to_owned()
            })?;
    }
    Ok(())
}

fn validate_sqlite_result_expression(
    expression: &ValueExpression,
    actions: &[SqliteAction],
) -> Result<(), String> {
    match expression {
        ValueExpression::SqliteRunChanges { result, .. }
        | ValueExpression::SqliteRunLastInsertRowId { result, .. } => match actions.get(*result) {
            Some(SqliteAction::Exec {
                result: Some(slot), ..
            }) if slot == result => Ok(()),
            _ => Err("SQLite result value references a missing run action".to_owned()),
        },
        ValueExpression::DirectCall { arguments, .. }
        | ValueExpression::Concat {
            values: arguments, ..
        } => arguments
            .iter()
            .try_for_each(|value| validate_sqlite_result_expression(value, actions)),
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            validate_sqlite_result_expression(left, actions)?;
            validate_sqlite_result_expression(right, actions)?;
            validate_sqlite_result_expression(when_equal, actions)?;
            validate_sqlite_result_expression(when_not_equal, actions)
        }
        ValueExpression::NumericBinary { left, right, .. } => {
            validate_sqlite_result_expression(left, actions)?;
            validate_sqlite_result_expression(right, actions)
        }
        ValueExpression::ThrowValue { value, .. } => {
            validate_sqlite_result_expression(value, actions)
        }
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => {
            validate_sqlite_result_expression(try_value, actions)?;
            validate_sqlite_result_expression(catch_value, actions)
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => {
            validate_sqlite_result_expression(when_present, actions)?;
            validate_sqlite_result_expression(when_absent, actions)
        }
        ValueExpression::WorkerCall { input, .. } => {
            validate_sqlite_result_expression(input, actions)
        }
        _ => Ok(()),
    }
}

fn response_uses_openai(response: &HandlerResponse) -> bool {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => false,
        HandlerResponse::Text { value, .. } => expression_uses_openai(value),
        HandlerResponse::Stream { chunks, .. } => chunks.iter().any(expression_uses_openai),
    }
}

fn response_uses_filesystem(response: &HandlerResponse) -> bool {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => false,
        HandlerResponse::Text { value, .. } => expression_uses_filesystem(value),
        HandlerResponse::Stream { chunks, .. } => chunks.iter().any(expression_uses_filesystem),
    }
}

fn expression_uses_filesystem(expression: &ValueExpression) -> bool {
    match expression {
        ValueExpression::FileText { .. } => true,
        ValueExpression::Concat { values, .. } => values.iter().any(expression_uses_filesystem),
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.iter().any(expression_uses_filesystem)
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_filesystem(value)),
        ValueExpression::NumericBinary { left, right, .. } => {
            expression_uses_filesystem(left) || expression_uses_filesystem(right)
        }
        ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_filesystem(value)),
        ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_filesystem(value)),
        ValueExpression::ThrowValue { value, .. } => expression_uses_filesystem(value),
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => expression_uses_filesystem(try_value) || expression_uses_filesystem(catch_value),
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => expression_uses_filesystem(when_present) || expression_uses_filesystem(when_absent),
        ValueExpression::WorkerCall { input, .. } => expression_uses_filesystem(input),
        _ => false,
    }
}

fn collect_response_environment_ids(response: &HandlerResponse, ids: &mut BTreeSet<usize>) {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => {}
        HandlerResponse::Text { value, .. } => collect_environment_ids(value, ids),
        HandlerResponse::Stream { chunks, .. } => {
            for chunk in chunks {
                collect_environment_ids(chunk, ids);
            }
        }
    }
}

fn collect_environment_ids(expression: &ValueExpression, ids: &mut BTreeSet<usize>) {
    match expression {
        ValueExpression::EnvironmentVariable { name, .. } => {
            ids.insert(*name);
        }
        ValueExpression::Concat { values, .. } => {
            for value in values {
                collect_environment_ids(value, ids);
            }
        }
        ValueExpression::DirectCall { arguments, .. } => {
            for argument in arguments {
                collect_environment_ids(argument, ids);
            }
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            collect_environment_ids(left, ids);
            collect_environment_ids(right, ids);
            collect_environment_ids(when_equal, ids);
            collect_environment_ids(when_not_equal, ids);
        }
        ValueExpression::NumericBinary { left, right, .. } => {
            collect_environment_ids(left, ids);
            collect_environment_ids(right, ids);
        }
        ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            collect_environment_ids(left, ids);
            collect_environment_ids(right, ids);
            collect_environment_ids(when_equal, ids);
            collect_environment_ids(when_not_equal, ids);
        }
        ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            collect_environment_ids(left, ids);
            collect_environment_ids(right, ids);
            collect_environment_ids(when_equal, ids);
            collect_environment_ids(when_not_equal, ids);
        }
        ValueExpression::ThrowValue { value, .. } => collect_environment_ids(value, ids),
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => {
            collect_environment_ids(try_value, ids);
            collect_environment_ids(catch_value, ids);
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => {
            collect_environment_ids(when_present, ids);
            collect_environment_ids(when_absent, ids);
        }
        ValueExpression::WorkerCall { input, .. } => collect_environment_ids(input, ids),
        _ => {}
    }
}

fn expression_uses_openai(expression: &ValueExpression) -> bool {
    match expression {
        ValueExpression::OpenAiChatText { .. } => true,
        ValueExpression::Concat { values, .. } => values.iter().any(expression_uses_openai),
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.iter().any(expression_uses_openai)
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_openai(value)),
        ValueExpression::NumericBinary { left, right, .. } => {
            expression_uses_openai(left) || expression_uses_openai(right)
        }
        ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_openai(value)),
        ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_openai(value)),
        ValueExpression::ThrowValue { value, .. } => expression_uses_openai(value),
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => expression_uses_openai(try_value) || expression_uses_openai(catch_value),
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => expression_uses_openai(when_present) || expression_uses_openai(when_absent),
        ValueExpression::WorkerCall { input, .. } => expression_uses_openai(input),
        _ => false,
    }
}

fn response_uses_network(response: &HandlerResponse) -> bool {
    match response {
        HandlerResponse::Html { .. } | HandlerResponse::Asset { .. } => false,
        HandlerResponse::Text { value, .. } => expression_uses_network(value),
        HandlerResponse::Stream { chunks, .. } => chunks.iter().any(expression_uses_network),
    }
}

fn expression_uses_network(expression: &ValueExpression) -> bool {
    match expression {
        ValueExpression::FetchStatus { .. } | ValueExpression::OpenAiChatText { .. } => true,
        ValueExpression::Concat { values, .. } => values.iter().any(expression_uses_network),
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.iter().any(expression_uses_network)
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        }
        | ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => [left, right, when_equal, when_not_equal]
            .into_iter()
            .any(|value| expression_uses_network(value)),
        ValueExpression::NumericBinary { left, right, .. } => {
            expression_uses_network(left) || expression_uses_network(right)
        }
        ValueExpression::ThrowValue { value, .. } => expression_uses_network(value),
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => expression_uses_network(try_value) || expression_uses_network(catch_value),
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => expression_uses_network(when_present) || expression_uses_network(when_absent),
        ValueExpression::WorkerCall { input, .. } => expression_uses_network(input),
        _ => false,
    }
}

fn validate_memory_report(memory: &MemoryReport, modules: &HashSet<&str>) -> Result<(), String> {
    if memory.policy.is_empty() {
        if memory.managed_heap_required
            || !memory.sites.is_empty()
            || memory.summary != MemorySummary::default()
        {
            return Err("legacy HIR memory report must be empty".to_owned());
        }
        return Ok(());
    }
    if memory.policy != "arena" {
        return Err(format!("unsupported memory policy `{}`", memory.policy));
    }

    let mut summary = MemorySummary::default();
    for site in &memory.sites {
        if !modules.contains(site.module.as_str()) {
            return Err(format!(
                "memory allocation site references missing module `{}`",
                site.module
            ));
        }
        if site.line == 0
            || site.column == 0
            || site.value_kind.is_empty()
            || site.instances == 0
            || site.max_references == 0
        {
            return Err("memory allocation site contains invalid evidence".to_owned());
        }
        match (site.lifetime.as_str(), site.escape.as_str()) {
            ("compileTime", "none") => summary.compile_time += 1,
            ("static", "response") => summary.static_sites += 1,
            ("request", "response") => summary.request += 1,
            ("request", "none") if site.value_kind == "runtimeMap" => summary.request += 1,
            ("worker", "worker") => summary.worker += 1,
            ("message", "message") => summary.message += 1,
            ("managed", "process") => summary.managed += 1,
            _ => {
                return Err(format!(
                    "invalid memory lifetime/escape pair `{}/{}`",
                    site.lifetime, site.escape
                ));
            }
        }
        if site.max_references > 1 {
            summary.aliased_sites += 1;
        }
        if site.escape == "response" {
            summary.response_escapes += 1;
        }
    }
    if memory.summary != summary {
        return Err("memory summary does not match allocation sites".to_owned());
    }
    if memory.managed_heap_required != (summary.managed > 0) {
        return Err("managed heap flag does not match allocation lifetimes".to_owned());
    }
    Ok(())
}

fn validate_route_pattern(pattern: &str) -> Result<(), String> {
    let segments: Vec<&str> = pattern.split('/').filter(|part| !part.is_empty()).collect();
    for (index, segment) in segments.iter().enumerate() {
        if *segment == "*" {
            if index + 1 != segments.len() {
                return Err("route wildcard must be the final segment".to_owned());
            }
            continue;
        }
        if let Some(name) = segment.strip_prefix(':') {
            let (name, constraint) = name
                .split_once('{')
                .map_or((name, None), |(name, constraint)| (name, Some(constraint)));
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                || constraint.is_some_and(|constraint| {
                    constraint != "[0-9]+}" && !(constraint == ".*}" && index + 1 == segments.len())
                })
            {
                return Err(format!("unsupported route parameter segment `{segment}`"));
            }
        } else if segment.contains([':', '*', '{', '}']) {
            return Err(format!("unsupported dynamic route segment `{segment}`"));
        }
    }
    Ok(())
}

fn valid_provider_url(url: &str) -> bool {
    url.starts_with("https://")
        || url.starts_with("http://127.0.0.1:")
        || url.starts_with("http://localhost:")
}

fn route_parameter_name(segment: &str) -> Option<&str> {
    let parameter = segment.strip_prefix(':')?;
    Some(
        parameter
            .strip_suffix("{[0-9]+}")
            .or_else(|| parameter.strip_suffix("{.*}"))
            .unwrap_or(parameter),
    )
}

fn handler_path_has_parameter_segment(path: &str, expected: usize) -> bool {
    path.split('/')
        .filter(|part| !part.is_empty())
        .nth(expected)
        .is_some_and(|segment| {
            route_parameter_name(segment).is_some() && !segment.ends_with("{.*}")
        })
}

fn root_path() -> String {
    "/".to_owned()
}

fn ok_status() -> u16 {
    200
}

fn validate_response_headers(
    headers: &[StaticHeader],
    elapsed_headers: &[ElapsedHeader],
) -> Result<(), String> {
    if headers.len() + elapsed_headers.len() > 16 {
        return Err("handler contains more than sixteen response headers".to_owned());
    }
    let mut names = HashSet::new();
    for header in headers {
        let normalized = header.name.to_ascii_lowercase();
        if !valid_header_name(header.name.as_bytes())
            || header
                .value
                .bytes()
                .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
            || !names.insert(normalized)
        {
            return Err("handler contains invalid or duplicate headers".to_owned());
        }
    }
    for header in elapsed_headers {
        let normalized = header.name.to_ascii_lowercase();
        if !valid_header_name(header.name.as_bytes())
            || header
                .suffix
                .bytes()
                .any(|byte| matches!(byte, b'\0' | b'\r' | b'\n'))
            || !names.insert(normalized)
        {
            return Err("handler contains invalid or duplicate headers".to_owned());
        }
    }
    Ok(())
}

fn valid_header_name(name: &[u8]) -> bool {
    !name.is_empty()
        && name.iter().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

fn validate_constant_value(value: &ConstantValue, depth: usize) -> Result<(), String> {
    if depth > 128 {
        return Err("constant value nesting exceeds 128 levels".to_owned());
    }
    match value {
        ConstantValue::Number { value } if !value.is_finite() => {
            Err("constant number must be finite".to_owned())
        }
        ConstantValue::Symbol { id, description }
            if *id >= 65_536
                || description
                    .as_ref()
                    .is_some_and(|description| description.len() > 256) =>
        {
            Err("constant symbol exceeds its ID or 256-byte description limit".to_owned())
        }
        ConstantValue::Bigint { value } if !is_canonical_bigint(value) => {
            Err("constant bigint must use canonical decimal notation".to_owned())
        }
        ConstantValue::Array { items } => {
            for item in items {
                validate_constant_value(item, depth + 1)?;
            }
            Ok(())
        }
        ConstantValue::Record { fields } => {
            let mut names = HashSet::new();
            for field in fields {
                if !names.insert(field.name.as_str()) {
                    return Err(format!("duplicate constant record field `{}`", field.name));
                }
                validate_constant_value(&field.value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn valid_request_json_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && path.split('\0').count() <= 4
        && path
            .split('\0')
            .all(|segment| !segment.is_empty() && segment.len() <= 128)
}

fn validate_actor_supervision(
    supervisors: &[SupervisorModule],
    actors: &[ActorModule],
) -> Result<(), String> {
    if supervisors.len() > 8 {
        return Err("program exceeds the 8-supervisor limit".to_owned());
    }
    for (index, supervisor) in supervisors.iter().enumerate() {
        if supervisor.id != index {
            return Err(format!("supervisor id {} is not canonical", supervisor.id));
        }
        if supervisor.max_restarts == 0
            || supervisor.max_restarts > 16
            || supervisor.within_ms == 0
            || supervisor.within_ms > 60_000
        {
            return Err(format!(
                "supervisor {index} has invalid restart configuration"
            ));
        }
    }

    let mut children = vec![0_usize; supervisors.len()];
    for (index, actor) in actors.iter().enumerate() {
        let Some(supervisor) = actor.supervisor else {
            continue;
        };
        let Some(count) = children.get_mut(supervisor) else {
            return Err(format!("actor {index} references a missing supervisor"));
        };
        if !matches!(actor.operation, ActorOperation::FallibleCounter)
            || actor.restart.is_some()
            || actor.persistence.is_some()
        {
            return Err(format!(
                "actor {index} has invalid supervised configuration"
            ));
        }
        *count += 1;
    }
    for (supervisor, children) in children.into_iter().enumerate() {
        if children == 0 || children > 16 {
            return Err(format!(
                "supervisor {supervisor} child count is outside 1..=16"
            ));
        }
    }
    Ok(())
}

fn validate_actor_json(input: &str) -> Result<(), String> {
    if input.is_empty() || input.len() > 4_096 {
        return Err("is outside the 1..=4096 byte limit".to_owned());
    }
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|_| "is not valid JSON".to_owned())?;
    validate_actor_json_value(&value, 0)
}

fn validate_actor_json_value(value: &serde_json::Value, depth: usize) -> Result<(), String> {
    if depth > 8 {
        return Err("exceeds 8 nested levels".to_owned());
    }
    match value {
        serde_json::Value::Null | serde_json::Value::Bool(_) => Ok(()),
        serde_json::Value::String(value) if value.len() <= 1_024 => Ok(()),
        serde_json::Value::String(_) => Err("contains a string larger than 1024 bytes".to_owned()),
        serde_json::Value::Number(value) => {
            const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
            let safe = value
                .as_i64()
                .map(|value| value.unsigned_abs() <= MAX_SAFE_INTEGER)
                .or_else(|| value.as_u64().map(|value| value <= MAX_SAFE_INTEGER))
                .unwrap_or(false);
            if safe {
                Ok(())
            } else {
                Err("contains a non-safe integer".to_owned())
            }
        }
        serde_json::Value::Array(items) => {
            if items.len() > 64 {
                return Err("contains an array larger than 64 items".to_owned());
            }
            items
                .iter()
                .try_for_each(|item| validate_actor_json_value(item, depth + 1))
        }
        serde_json::Value::Object(fields) => {
            if fields.len() > 32 {
                return Err("contains a record larger than 32 fields".to_owned());
            }
            for (name, field) in fields {
                if name.len() > 128 {
                    return Err("contains a field name larger than 128 bytes".to_owned());
                }
                validate_actor_json_value(field, depth + 1)?;
            }
            Ok(())
        }
    }
}

fn is_canonical_bigint(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty()
        && !digits.starts_with('0')
        && digits.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    #[test]
    fn validates_consistent_arena_evidence() {
        let memory = MemoryReport {
            policy: "arena".to_owned(),
            managed_heap_required: false,
            sites: vec![MemoryAllocationSite {
                module: "app.ts".to_owned(),
                line: 1,
                column: 1,
                value_kind: "string".to_owned(),
                instances: 1,
                max_references: 2,
                lifetime: "static".to_owned(),
                escape: "response".to_owned(),
            }],
            summary: MemorySummary {
                static_sites: 1,
                aliased_sites: 1,
                response_escapes: 1,
                ..MemorySummary::default()
            },
        };
        let modules = HashSet::from(["app.ts"]);

        assert_eq!(validate_memory_report(&memory, &modules), Ok(()));
    }

    #[test]
    fn validates_a_non_escaping_request_local_map() {
        let memory = MemoryReport {
            policy: "arena".to_owned(),
            managed_heap_required: false,
            sites: vec![MemoryAllocationSite {
                module: "app.ts".to_owned(),
                line: 1,
                column: 1,
                value_kind: "runtimeMap".to_owned(),
                instances: 1,
                max_references: 2,
                lifetime: "request".to_owned(),
                escape: "none".to_owned(),
            }],
            summary: MemorySummary {
                request: 1,
                aliased_sites: 1,
                ..MemorySummary::default()
            },
        };
        let modules = HashSet::from(["app.ts"]);

        assert_eq!(validate_memory_report(&memory, &modules), Ok(()));
    }

    #[test]
    fn rejects_a_summary_not_backed_by_sites() {
        let memory = MemoryReport {
            policy: "arena".to_owned(),
            summary: MemorySummary {
                managed: 1,
                ..MemorySummary::default()
            },
            ..MemoryReport::default()
        };
        let modules = HashSet::from(["app.ts"]);

        assert_eq!(
            validate_memory_report(&memory, &modules),
            Err("memory summary does not match allocation sites".to_owned()),
        );
    }
}

#[cfg(test)]
mod actor_supervision_tests {
    use super::*;

    fn supervisor() -> SupervisorModule {
        SupervisorModule {
            id: 0,
            strategy: SupervisorStrategy::OneForOne,
            max_restarts: 2,
            within_ms: 60_000,
        }
    }

    fn child(supervisor: Option<usize>) -> ActorModule {
        ActorModule {
            id: 0,
            operation: ActorOperation::FallibleCounter,
            initial_state: 0,
            initial_json: None,
            mailbox_capacity: 64,
            failure_message: Some(-1),
            restart: None,
            supervisor,
            persistence: None,
        }
    }

    #[test]
    fn validates_supervisor_cross_references_and_child_bounds() {
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &[child(Some(0))]),
            Ok(())
        );
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &[child(Some(1))]),
            Err("actor 0 references a missing supervisor".to_owned())
        );
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &[]),
            Err("supervisor 0 child count is outside 1..=16".to_owned())
        );

        let mut children = (0..17).map(|_| child(Some(0))).collect::<Vec<_>>();
        for (id, child) in children.iter_mut().enumerate() {
            child.id = id;
        }
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &children),
            Err("supervisor 0 child count is outside 1..=16".to_owned())
        );
    }

    #[test]
    fn rejects_local_restart_or_persistence_on_a_supervised_child() {
        let mut restarted = child(Some(0));
        restarted.restart = Some(ActorRestart {
            max_restarts: 1,
            within_ms: 1_000,
        });
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &[restarted]),
            Err("actor 0 has invalid supervised configuration".to_owned())
        );

        let mut persistent = child(Some(0));
        persistent.persistence = Some(ActorPersistence {
            database: 0,
            key: "counter".to_owned(),
        });
        assert_eq!(
            validate_actor_supervision(&[supervisor()], &[persistent]),
            Err("actor 0 has invalid supervised configuration".to_owned())
        );
    }
}

#[cfg(test)]
mod actor_json_tests {
    use super::*;

    #[test]
    fn accepts_the_bounded_actor_value_shape() {
        assert_eq!(
            validate_actor_json(r#"{"ready":true,"count":3,"tags":["one",null]}"#),
            Ok(()),
        );
    }

    #[test]
    fn rejects_values_outside_the_actor_contract() {
        let oversized_array = format!("[{}]", vec!["0"; 65].join(","));
        let oversized_string = serde_json::to_string(&"x".repeat(1_025)).unwrap();

        assert!(validate_actor_json("{not-json}").is_err());
        assert!(validate_actor_json("1.5").is_err());
        assert!(validate_actor_json(&oversized_array).is_err());
        assert!(validate_actor_json(&oversized_string).is_err());
    }
}

#[cfg(test)]
mod request_id_tests {
    use super::*;

    #[test]
    fn requires_request_id_values_to_match_middleware_configuration() {
        let expression = ValueExpression::RequestId {
            header: 3,
            span: SourceSpan {
                file: "app.ts".to_owned(),
                line: 1,
                column: 1,
                end_line: 1,
                end_column: 2,
            },
        };

        assert_eq!(validate_request_id_expression(&expression, Some(3)), Ok(()));
        assert_eq!(
            validate_request_id_expression(&expression, None),
            Err("request ID value requires request ID middleware".to_owned()),
        );
        assert_eq!(
            validate_request_id_expression(&expression, Some(4)),
            Err("request ID value does not match its middleware header".to_owned()),
        );
    }
}

#[cfg(test)]
mod request_json_path_tests {
    use super::*;

    fn strings(count: usize) -> Vec<StaticString> {
        (0..count)
            .map(|id| StaticString {
                id,
                value: format!("field{id}"),
            })
            .collect()
    }

    #[test]
    fn validates_depth_segment_and_encoded_path_bounds() {
        assert!(valid_request_json_path("profile\0preferences\0theme"));
        assert!(!valid_request_json_path(""));
        assert!(!valid_request_json_path("a\0b\0c\0d\0e"));
        assert!(!valid_request_json_path(&"x".repeat(129)));
        assert!(!valid_request_json_path(
            &[
                "a".repeat(128),
                "b".repeat(128),
                "c".repeat(128),
                "d".repeat(128)
            ]
            .join("\0")
        ));
    }

    #[test]
    fn admits_sixteen_distinct_leaf_paths_and_rejects_seventeen() {
        let static_strings = strings(17);
        let sixteen = (0..16).collect::<HashSet<_>>();
        let seventeen = (0..17).collect::<HashSet<_>>();

        assert_eq!(
            validate_request_json_path_fields(&sixteen, &static_strings),
            Ok(())
        );
        assert_eq!(
            validate_request_json_path_fields(&seventeen, &static_strings),
            Err("handler selects more than sixteen request JSON leaf paths".to_owned())
        );
    }
}

#[cfg(test)]
mod sqlite_result_tests {
    use super::*;

    fn span() -> SourceSpan {
        SourceSpan {
            file: "app.ts".to_owned(),
            line: 1,
            column: 1,
            end_line: 1,
            end_column: 2,
        }
    }

    #[test]
    fn requires_sqlite_result_values_to_reference_their_run_action() {
        let expression = ValueExpression::SqliteRunChanges {
            result: 0,
            span: span(),
        };
        let actions = [SqliteAction::Exec {
            database: 0,
            sql: 0,
            parameters: Vec::new(),
            result: Some(0),
        }];

        assert_eq!(
            validate_sqlite_result_expression(&expression, &actions),
            Ok(())
        );
        assert_eq!(
            validate_sqlite_result_expression(&expression, &[]),
            Err("SQLite result value references a missing run action".to_owned()),
        );
    }
}

#[cfg(test)]
mod sqlite_transaction_tests {
    use super::*;

    fn strings(value: &str) -> Vec<StaticString> {
        vec![StaticString {
            id: 0,
            value: value.to_owned(),
        }]
    }

    fn step(parameters: usize) -> SqliteTransactionStep {
        SqliteTransactionStep {
            sql: 0,
            parameters: (0..parameters).map(|_| SqliteParameter::Null).collect(),
        }
    }

    #[test]
    fn bounds_prepared_transaction_steps_sql_and_parameters() {
        assert_eq!(
            validate_sqlite_transaction_limits(&[step(16), step(16)], &strings("SELECT ?1")),
            Ok(())
        );
        assert_eq!(
            validate_sqlite_transaction_limits(&[], &strings("SELECT 1")),
            Err("SQLite prepared transaction requires one to sixteen steps".to_owned())
        );
        assert_eq!(
            validate_sqlite_transaction_limits(
                &(0..17).map(|_| step(0)).collect::<Vec<_>>(),
                &strings("SELECT 1"),
            ),
            Err("SQLite prepared transaction requires one to sixteen steps".to_owned())
        );
        assert_eq!(
            validate_sqlite_transaction_limits(
                &[step(16), step(16), step(16), step(16), step(1)],
                &strings("SELECT ?1")
            ),
            Err("SQLite prepared transaction exceeds the aggregate parameter limit".to_owned())
        );
        assert_eq!(
            validate_sqlite_transaction_limits(&[step(0)], &strings(&"x".repeat(65_537))),
            Err("SQLite prepared transaction exceeds the aggregate SQL limit".to_owned())
        );
    }
}

#[cfg(test)]
mod constant_value_tests {
    use super::*;

    #[test]
    fn admits_tagged_special_numbers_and_bounds_symbols() {
        for value in [
            SpecialNumber::NegativeZero,
            SpecialNumber::Nan,
            SpecialNumber::PositiveInfinity,
            SpecialNumber::NegativeInfinity,
        ] {
            assert_eq!(
                validate_constant_value(&ConstantValue::NumberSpecial { value }, 0),
                Ok(())
            );
        }
        assert_eq!(
            validate_constant_value(
                &ConstantValue::Symbol {
                    id: 65_535,
                    description: Some("x".repeat(256)),
                },
                0,
            ),
            Ok(())
        );
        for symbol in [
            ConstantValue::Symbol {
                id: 65_536,
                description: None,
            },
            ConstantValue::Symbol {
                id: 0,
                description: Some("x".repeat(257)),
            },
        ] {
            assert_eq!(
                validate_constant_value(&symbol, 0),
                Err("constant symbol exceeds its ID or 256-byte description limit".to_owned())
            );
        }
    }
}

#[cfg(test)]
mod response_header_tests {
    use super::*;

    #[test]
    fn admits_sixteen_response_headers_and_rejects_overflow() {
        let headers = (0..17)
            .map(|index| StaticHeader {
                name: format!("x-test-{index}"),
                value: "value".to_owned(),
            })
            .collect::<Vec<_>>();

        assert_eq!(validate_response_headers(&headers[..16], &[]), Ok(()));
        assert_eq!(
            validate_response_headers(&headers, &[]),
            Err("handler contains more than sixteen response headers".to_owned())
        );
    }
}
