import type { AndroidPrintDocument, AndroidPrintStatus } from "./android-print";
export interface AndroidNativeFile { name: string; data: Uint8Array; type?: string; mime?: string; requestId?: string }
export interface AndroidNativeHost { openFile(): Promise<AndroidNativeFile | null>; saveFile(file: AndroidNativeFile): Promise<boolean>; shareFile(file: AndroidNativeFile): Promise<{completed?: boolean; cancelled?: boolean}>; onOpenFile(receive:(file:AndroidNativeFile)=>void):()=>void; print():Promise<unknown>; printDocument?(document:AndroidPrintDocument):Promise<AndroidPrintStatus> }
declare global { interface Window { slideStudioAndroid?: AndroidNativeHost } }
