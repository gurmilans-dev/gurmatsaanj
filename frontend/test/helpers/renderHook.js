import { createElement } from 'react';
import { act, create } from 'react-test-renderer';

export function renderHook(hook, initialProps) {
  let result;
  let renderer;
  let props = initialProps;

  function Harness({ hookProps }) {
    result = hook(hookProps);
    return null;
  }

  act(() => {
    renderer = create(createElement(Harness, { hookProps: props }));
  });

  return {
    get result() { return result; },
    rerender(patch) {
      props = { ...props, ...patch };
      act(() => {
        renderer.update(createElement(Harness, { hookProps: props }));
      });
    },
    unmount() {
      act(() => { renderer.unmount(); });
    },
  };
}

export async function flushPromises() {
  await act(async () => {});
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
