let listeners = [];
let counter = 0;

export function toast(message, type = 'success') {
  counter += 1;
  const item = { id: counter, message, type };
  listeners.forEach((listener) => listener(item));
}

export function subscribeToasts(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
}
