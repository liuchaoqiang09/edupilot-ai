export function redirect() {
  throw new Error("redirect stub");
}
export function notFound() {
  throw new Error("notFound stub");
}
export function useRouter() {
  return { push() {}, replace() {}, refresh() {} };
}
export function usePathname() {
  return "/";
}
export function useSearchParams() {
  return new URLSearchParams();
}
