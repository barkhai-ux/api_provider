// The message tree is an arbitrarily nested map of strings, keyed by dot paths.
export type Messages = { [key: string]: string | Messages };
