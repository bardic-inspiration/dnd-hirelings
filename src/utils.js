/** Generates a random 7-character alphanumeric ID. Not cryptographically secure. */
export const uid = () => Math.random().toString(36).slice(2, 9);

/** Returns the current Unix timestamp in milliseconds. Wrapper kept for testability. */
export const now = () => Date.now();
