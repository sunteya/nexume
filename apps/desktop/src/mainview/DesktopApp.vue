<script setup lang="ts">
import {
  InitializationApp,
  SessionApp,
  type InitializationClient,
  type SessionClient,
} from "@nexume/admin-ui";
import { ref } from "vue";

import { desktopRpc } from "./rpc";

const ready = ref(false);
const initializationClient: InitializationClient = {
  getInitializationStatus: () => desktopRpc.request.getInitializationStatus(),
  completeInitialization: () => desktopRpc.request.completeInitialization({}),
};
const sessionClient: SessionClient = {
  listSessions: (params) => desktopRpc.request.listSessions(params),
};
</script>

<template>
  <initialization-app
    v-if="!ready"
    :client="initializationClient"
    @initialized="ready = true"
  />
  <session-app v-else :client="sessionClient" />
</template>
