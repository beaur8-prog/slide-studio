declare module "utif" {
  const UTIF: {
    decode(data: ArrayBuffer): Record<string, any>[];
    decodeImage(data: ArrayBuffer, image: Record<string, any>): void;
    toRGBA8(image: Record<string, any>): Uint8Array;
  };
  export default UTIF;
}
