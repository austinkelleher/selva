declare const KEYS: string[]
declare const ARGV: string[]

declare module redis {
  function call(this: void, ...args: string[]): any
}