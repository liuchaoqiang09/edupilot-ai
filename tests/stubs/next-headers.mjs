export function cookies() {
  return {
    get() {
      return undefined;
    },
    set() {},
    delete() {},
  };
}

export function headers() {
  return new Headers();
}
