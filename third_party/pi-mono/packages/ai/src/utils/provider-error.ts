import type { Api, Model, StreamOptions } from "../types.ts";

/**
 * Hands the original exception caught by the provider to the host synchronously.
 * The host callback is an observation side channel; even if it throws, it must not
 * replace the provider original failure result.
 */
export function notifyProviderError(
	callback: StreamOptions["onProviderError"],
	error: unknown,
	model: Model<Api>,
): void {
	try {
		callback?.(error, model);
	} catch {
		// A failed error observation must not affect the provider error handling.
	}
}

/** Provider-event inspection is an observation side channel, never control flow. */
export async function* observeProviderEvents<T>(
	events: AsyncIterable<T>,
	callback: NonNullable<StreamOptions["onProviderStreamEvent"]>,
	model: Model<Api>,
): AsyncGenerator<T> {
	for await (const event of events) {
		try {
			callback(event, model);
		} catch {
			// A failed event observation must not affect the provider stream.
		}
		yield event;
	}
}

/** Preserve the provider's original iterable when event inspection is disabled. */
export function withProviderEventObserver<T>(
	events: AsyncIterable<T>,
	callback: StreamOptions["onProviderStreamEvent"],
	model: Model<Api>,
): AsyncIterable<T> {
	return callback ? observeProviderEvents(events, callback, model) : events;
}
