export interface ToastMsg {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}
