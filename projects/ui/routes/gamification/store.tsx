/**
 * Store catalog page — user-facing cosmetic store.
 * Fetches /api/store for items, balance, and purchased list.
 * Renders sidebar navigation, wallet bar, and item cards.
 */

import { Head } from "fresh/runtime";
import { define } from "@/utils.ts";
import StoreIsland from "@/islands/StoreIsland.tsx";

export default define.page(function StorePage() {
  return (
    <>
      <Head>
        <title>AutoBot Store</title>
      </Head>
      <StoreIsland />
    </>
  );
});
