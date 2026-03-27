import { Component } from "@sprig/kit";

interface StoreItem {
  id: string;
  name: string;
  icon?: string;
  price: number;
}

interface StoreData {
  balance: number;
  items: StoreItem[];
  purchased: string[];
}

interface Toast {
  msg: string;
  type: "success" | "error";
  id: number;
}

@Component({ template: "./mod.html", island: true })
export class StoreView {
  storeData: StoreData | null = null;
  loading = true;
  error = "";
  toasts: Toast[] = [];

  private toastCounter = 0;

  showToast(msg: string, type: "success" | "error") {
    const id = ++this.toastCounter;
    this.toasts = [...this.toasts, { msg, type, id }];
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 2400);
  }

  async loadStore() {
    this.loading = true;
    try {
      const res = await fetch("/agent/api/store", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        if (res.status === 401) {
          globalThis.location.href = "/login";
          return;
        }
        throw new Error("Failed to load store");
      }
      this.storeData = await res.json();
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async buyItem(itemId: string) {
    try {
      const res = await fetch("/agent/api/store/buy", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Purchase failed");
      this.showToast(
        "Purchased! New balance: " + result.newBalance,
        "success",
      );
      this.loadStore();
    } catch (err) {
      this.showToast((err as Error).message, "error");
    }
  }

  isOwned(itemId: string): boolean {
    return (this.storeData?.purchased || []).includes(itemId);
  }

  canBuy(itemId: string, price: number): boolean {
    return !this.isOwned(itemId) && (this.storeData?.balance || 0) >= price;
  }
}
