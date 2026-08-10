import { InspectorNativeQueryBridge } from 'c/inspectorNativeQueryBridge';

describe('InspectorNativeQueryBridge', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves beginRequest() when handleResult() is given data', async () => {
    const bridge = new InspectorNativeQueryBridge();
    const promise = bridge.beginRequest();
    bridge.handleResult({ data: { foo: 'bar' } });
    await expect(promise).resolves.toEqual({ foo: 'bar' });
  });

  it('rejects beginRequest() when handleResult() is given errors', async () => {
    const bridge = new InspectorNativeQueryBridge();
    const promise = bridge.beginRequest();
    bridge.handleResult({ errors: [{ message: 'Boom' }] });
    await expect(promise).rejects.toThrow('Boom');
  });

  it('rejects with a generic message when errors has no message', async () => {
    const bridge = new InspectorNativeQueryBridge();
    const promise = bridge.beginRequest();
    bridge.handleResult({ errors: [{}] });
    await expect(promise).rejects.toThrow('Unknown error running a lookup query');
  });

  it('is a no-op when handleResult() fires with nothing pending', () => {
    const bridge = new InspectorNativeQueryBridge();
    expect(() => bridge.handleResult({ data: { foo: 'bar' } })).not.toThrow();
  });

  it('rejects a second beginRequest() while one is already pending, instead of silently misrouting', async () => {
    const bridge = new InspectorNativeQueryBridge();
    const firstPromise = bridge.beginRequest();
    await expect(bridge.beginRequest()).rejects.toThrow('one at a time');

    // The first request is still resolvable normally afterward.
    bridge.handleResult({ data: { first: true } });
    await expect(firstPromise).resolves.toEqual({ first: true });
  });

  it('allows a new request once the previous one has settled', async () => {
    const bridge = new InspectorNativeQueryBridge();
    const firstPromise = bridge.beginRequest();
    bridge.handleResult({ data: { first: true } });
    await firstPromise;

    const secondPromise = bridge.beginRequest();
    bridge.handleResult({ data: { second: true } });
    await expect(secondPromise).resolves.toEqual({ second: true });
  });

  it('times out if no result ever arrives, instead of hanging forever', async () => {
    jest.useFakeTimers();
    const bridge = new InspectorNativeQueryBridge(1000);
    const promise = bridge.beginRequest();
    const assertion = expect(promise).rejects.toThrow('Timed out');
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('allows a new request after a timeout (the slot is freed, not left stuck)', async () => {
    jest.useFakeTimers();
    const bridge = new InspectorNativeQueryBridge(1000);
    const firstPromise = bridge.beginRequest();
    const firstAssertion = expect(firstPromise).rejects.toThrow('Timed out');
    jest.advanceTimersByTime(1000);
    await firstAssertion;

    jest.useRealTimers();
    const secondPromise = bridge.beginRequest();
    bridge.handleResult({ data: { ok: true } });
    await expect(secondPromise).resolves.toEqual({ ok: true });
  });

  it('does not resolve a settled request again if a stray handleResult() fires late', async () => {
    jest.useFakeTimers();
    const bridge = new InspectorNativeQueryBridge(1000);
    const promise = bridge.beginRequest();
    const assertion = expect(promise).rejects.toThrow('Timed out');
    jest.advanceTimersByTime(1000);
    await assertion;

    // A late response arriving after the timeout must not throw or resolve anything stale.
    expect(() => bridge.handleResult({ data: { tooLate: true } })).not.toThrow();
  });
});
