export const classNames = (...classes: (string | false | undefined | null)[]): string => {
  return classes.filter(Boolean).join(' ');
};