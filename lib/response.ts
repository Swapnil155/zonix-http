import { ServerResponse } from "node:http";
import { ErrorCode, frameworkError } from "./errors.js";
import type { ZonixRequest } from "./request.js";

/**
 * The response object handed to every middleware and handler.
 *
 * Everything stock on `http.ServerResponse` still works; these are additions,
 * installed via `http.createServer({ ServerResponse })` rather than by patching
 * the prototype.
 */
export class ZonixResponse extends ServerResponse<ZonixRequest> {
  /** Set the status code. Chainable: `res.status(201).json(...)`. */
  status(code: number): this {
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw frameworkError(
        `res.status() expects an integer between 100 and 599, received ${String(code)}`,
        this.status,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.statusCode = code;
    return this;
  }

  /** Serialize `data` as JSON and end the response. */
  json(data: unknown): void {
    this.#assertOpen(this.json);
    const payload = JSON.stringify(data === undefined ? null : data);
    const body = Buffer.from(payload, "utf8");
    if (!this.hasHeader("Content-Type")) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    this.setHeader("Content-Length", body.byteLength);
    this.end(body);
  }

  /** Send a `Location` redirect. Defaults to 302 Found. */
  redirect(location: string, code = 302): void {
    this.#assertOpen(this.redirect);
    if (typeof location !== "string" || location.length === 0) {
      throw frameworkError(
        "res.redirect() requires a non-empty location string",
        this.redirect,
        ErrorCode.INVALID_ARGUMENT,
      );
    }
    this.statusCode = code;
    this.setHeader("Location", location);
    this.setHeader("Content-Length", 0);
    this.end();
  }

  #assertOpen(fn: (...args: never[]) => unknown): void {
    if (this.headersSent) {
      throw frameworkError(
        "Cannot write to the response after the headers have been sent",
        fn,
        ErrorCode.HEADERS_SENT,
      );
    }
  }
}
