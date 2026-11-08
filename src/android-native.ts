export interface AndroidNativeFile { name: string; data: Uint8Array; type?: string; mime?: string; requestId?: string }
export interface AndroidNativeHost { openFile(): Promise<AndroidNativeFile | null>; saveFile(file: AndroidNativeFile): Promise<boolean>; shareFile(file: AndroidNativeFile): Promise<{completed?: boolean; cancelled?: boolean}>; onOpenFile(receive:(file:AndroidNativeFile)=>void):()=>void; print():Promise<unknown> }
declare global { interface Window { slideStudioAndroid?: AndroidNativeHost } }
