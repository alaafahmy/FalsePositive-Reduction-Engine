"use strict";
// ============================================================
// types.ts — Canonical ZeroFalse type definitions
// All types strictly match the specification.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentError = exports.ValidationError = void 0;
// ------- Pipeline Errors -------
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}
exports.ValidationError = ValidationError;
class EnvironmentError extends Error {
    constructor(message) {
        super(message);
        this.name = "EnvironmentError";
    }
}
exports.EnvironmentError = EnvironmentError;
//# sourceMappingURL=types.js.map