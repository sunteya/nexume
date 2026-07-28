import { Electroview } from "electrobun/view";

import type { DesktopRPC } from "../shared/desktop-rpc";

const rpc = Electroview.defineRPC<DesktopRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {},
    messages: {},
  },
});

new Electroview({ rpc });

export const desktopRpc = rpc;
