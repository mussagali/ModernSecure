declare module "heic-decode" {
  type DecodedImage = { width: number; height: number; data: Uint8ClampedArray };
  type ImageHandle = { width: number; height: number; decode(): Promise<DecodedImage> };
  type ImageHandles = Array<ImageHandle> & { dispose(): void };
  const decode: { all(input: { buffer: Buffer }): Promise<ImageHandles> };
  export default decode;
}
