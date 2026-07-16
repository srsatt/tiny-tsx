/** Read-only startup environment snapshot. Requires --allow-env for each name. */
export declare function get(name: string): string | undefined;

/** Like get(), but reports a recoverable missing-value error. */
export declare function require(name: string): string;
