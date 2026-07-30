<script setup lang="ts">
import {
  ElButton,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElOptionGroup,
  ElSelect,
  ElTooltip,
} from "element-plus"
import { Folder, FolderOpen, MoreHorizontal, Plus } from "lucide-vue-next"
import { computed, onMounted, ref } from "vue"

import type {
  AvailableSessionDirectory,
  ProjectDirectory,
  ProjectInfo,
} from "@nexume/contracts"
import type { ProjectClient } from "./client"

const props = defineProps<{
  client: ProjectClient
  activeProjectId?: string
}>()

const emit = defineEmits<{
  select: [projectId: string | undefined, projectName: string]
  change: []
}>()

const projects = ref<ProjectInfo[]>([])
const availableDirectories = ref<AvailableSessionDirectory[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const editingProject = ref<ProjectInfo>()
const name = ref("")
const selectedDirectoryKeys = ref<string[]>([])

function directoryKey(directory: ProjectDirectory): string {
  return JSON.stringify([directory.collectorId, directory.directory])
}

function parseDirectoryKey(key: string): ProjectDirectory {
  const [collectorId, directory] = JSON.parse(key) as [string, string]
  return { collectorId, directory }
}

const directoryOptions = computed(() => {
  const merged = new Map<string, AvailableSessionDirectory>()
  for (const item of availableDirectories.value) {
    merged.set(directoryKey(item), item)
  }
  for (const item of editingProject.value?.directories ?? []) {
    const key = directoryKey(item)
    if (!merged.has(key)) {
      merged.set(key, {
        ...item,
        collectorName: item.collectorId,
        projectId: editingProject.value!.id,
        projectName: editingProject.value!.name,
      })
    }
  }
  return [...merged.values()]
})

const directoryGroups = computed(() => {
  const groups = new Map<string, AvailableSessionDirectory[]>()
  for (const item of directoryOptions.value) {
    const group = groups.get(item.collectorName) ?? []
    group.push(item)
    groups.set(item.collectorName, group)
  }
  return [...groups.entries()].map(([collectorName, items]) => ({
    collectorName,
    items,
  }))
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [projectItems, directories] = await Promise.all([
      props.client.list(),
      props.client.listDirectories(),
    ])
    projects.value = projectItems
    availableDirectories.value = directories
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "Unable to load projects.",
    )
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingProject.value = undefined
  name.value = ""
  selectedDirectoryKeys.value = []
  dialogVisible.value = true
}

function openEdit(project: ProjectInfo): void {
  editingProject.value = project
  name.value = project.name
  selectedDirectoryKeys.value = project.directories.map(directoryKey)
  dialogVisible.value = true
}

async function save(): Promise<void> {
  const projectName = name.value.trim()
  if (!projectName) {
    ElMessage.warning("Enter a project name.")
    return
  }
  saving.value = true
  try {
    const input = {
      name: projectName,
      directories: selectedDirectoryKeys.value.map(parseDirectoryKey),
    }
    const saved = editingProject.value
      ? await props.client.update(editingProject.value.id, input)
      : await props.client.create(input)
    dialogVisible.value = false
    await load()
    emit("change")
    emit("select", saved.id, saved.name)
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "Unable to save the project.",
    )
  } finally {
    saving.value = false
  }
}

async function remove(project: ProjectInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `Delete project “${project.name}”? Sessions will remain available under Unassigned.`,
      "Delete project",
      { confirmButtonText: "Delete", type: "warning" },
    )
    await props.client.delete(project.id)
    await load()
    emit("change")
    if (props.activeProjectId === project.id)
      emit("select", undefined, "Unassigned")
  } catch (error) {
    if (error === "cancel" || error === "close") return
    ElMessage.error(
      error instanceof Error ? error.message : "Unable to delete the project.",
    )
  }
}

function handleCommand(command: string, project: ProjectInfo): void {
  if (command === "edit") openEdit(project)
  else if (command === "delete") void remove(project)
}

onMounted(() => void load())
</script>

<template>
  <aside class="project-sidebar" aria-label="Projects">
    <div class="project-sidebar-heading">
      <span>Projects</span>
      <el-tooltip content="New project" placement="right">
        <el-button circle text aria-label="New project" @click="openCreate">
          <plus :size="16" :stroke-width="1.8" />
        </el-button>
      </el-tooltip>
    </div>

    <nav v-loading="loading" class="project-navigation">
      <button
        type="button"
        class="project-navigation-item"
        :class="{ 'is-active': !activeProjectId }"
        @click="emit('select', undefined, 'Unassigned')"
      >
        <folder-open :size="16" :stroke-width="1.8" />
        <span>Unassigned</span>
      </button>

      <div
        v-for="project in projects"
        :key="project.id"
        class="project-navigation-row"
        :class="{ 'is-active': activeProjectId === project.id }"
      >
        <button
          type="button"
          class="project-navigation-item"
          @click="emit('select', project.id, project.name)"
        >
          <folder :size="16" :stroke-width="1.8" />
          <span>{{ project.name }}</span>
          <small>{{ project.directories.length }}</small>
        </button>
        <el-dropdown
          trigger="click"
          @command="handleCommand($event as string, project)"
        >
          <button
            class="project-more-button"
            type="button"
            :aria-label="`Manage ${project.name}`"
          >
            <more-horizontal :size="16" :stroke-width="1.8" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="edit">Edit</el-dropdown-item>
              <el-dropdown-item
                command="delete"
                class="danger-dropdown-item"
                divided
              >
                Delete
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </nav>
  </aside>

  <el-dialog
    v-model="dialogVisible"
    :title="editingProject ? 'Edit project' : 'New project'"
    width="min(620px, calc(100vw - 24px))"
  >
    <form class="project-form" @submit.prevent="save">
      <div class="project-form-field">
        <label for="project-name">Name</label>
        <el-input
          id="project-name"
          v-model="name"
          maxlength="128"
          placeholder="Project name"
          autofocus
        />
      </div>
      <div class="project-form-field">
        <span id="project-directories-label">Directories</span>
        <el-select
          v-model="selectedDirectoryKeys"
          aria-labelledby="project-directories-label"
          multiple
          filterable
          :allow-create="false"
          :reserve-keyword="false"
          collapse-tags
          collapse-tags-tooltip
          placeholder="Select collected directories"
        >
          <el-option-group
            v-for="group in directoryGroups"
            :key="group.collectorName"
            :label="group.collectorName"
          >
            <el-option
              v-for="item in group.items"
              :key="directoryKey(item)"
              :value="directoryKey(item)"
              :label="item.directory"
              :disabled="
                Boolean(item.projectId && item.projectId !== editingProject?.id)
              "
            >
              <div class="project-directory-option">
                <span>{{ item.directory || "(no directory)" }}</span>
                <small
                  v-if="item.projectId && item.projectId !== editingProject?.id"
                >
                  {{ item.projectName }}
                </small>
              </div>
            </el-option>
          </el-option-group>
        </el-select>
      </div>
    </form>
    <template #footer>
      <el-button @click="dialogVisible = false">Cancel</el-button>
      <el-button type="primary" :loading="saving" @click="save">Save</el-button>
    </template>
  </el-dialog>
</template>
