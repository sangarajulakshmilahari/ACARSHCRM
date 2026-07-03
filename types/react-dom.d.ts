declare module "react-dom" {
  export function createPortal(
    children: any,
    container: Element | DocumentFragment,
    key?: null | string
  ): any;
}
