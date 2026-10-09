export function freezeSnapshot<T>(value:T):T {
  if(value && typeof value==='object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(child=>freezeSnapshot(child));
  }
  return value;
}
