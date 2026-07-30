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
import {
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
} from "lucide-vue-next"
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
const groupName = ref("")
const selectedDirectoryKeys = ref<string[]>([])
const collapsedGroupKeys = ref(new Set<string>())

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

const ungroupedProjects = computed(() =>
  projects.value.filter((project) => !project.groupName),
)

const projectGroups = computed(() => {
  const groups = new Map<
    string,
    { key: string; name: string; projects: ProjectInfo[] }
  >()
  for (const project of projects.value) {
    if (!project.groupName) continue

    const key = project.groupName.toLocaleLowerCase("en-US")
    const group = groups.get(key) ?? {
      key,
      name: project.groupName,
      projects: [],
    }
    group.projects.push(project)
    groups.set(key, group)
  }
  return [...groups.values()]
})

function isGroupCollapsed(key: string): boolean {
  return collapsedGroupKeys.value.has(key)
}

function toggleGroup(key: string): void {
  const collapsed = new Set(collapsedGroupKeys.value)
  if (collapsed.has(key)) collapsed.delete(key)
  else collapsed.add(key)
  collapsedGroupKeys.value = collapsed
}

function expandGroup(group: string | undefined): void {
  if (!group) return
  const collapsed = new Set(collapsedGroupKeys.value)
  collapsed.delete(group.toLocaleLowerCase("en-US"))
  collapsedGroupKeys.value = collapsed
}

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
  groupName.value = ""
  selectedDirectoryKeys.value = []
  dialogVisible.value = true
}

function openEdit(project: ProjectInfo): void {
  editingProject.value = project
  name.value = project.name
  groupName.value = project.groupName ?? ""
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
      ...(groupName.value.trim() ? { groupName: groupName.value.trim() } : {}),
      directories: selectedDirectoryKeys.value.map(parseDirectoryKey),
    }
    const saved = editingProject.value
      ? await props.client.update(editingProject.value.id, input)
      : await props.client.create(input)
    dialogVisible.value = false
    await load()
    expandGroup(saved.groupName)
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
  <aside
    class="project-sidebar"
    :class="{ 'has-groups': projectGroups.length > 0 }"
    aria-label="Projects"
  >
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
        v-for="project in ungroupedProjects"
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

      <section
        v-for="group in projectGroups"
        :key="group.key"
        class="project-navigation-group"
        :aria-label="group.name"
      >
        <button
          type="button"
          class="project-group-heading"
          :aria-expanded="!isGroupCollapsed(group.key)"
          @click="toggleGroup(group.key)"
        >
          <chevron-right
            class="project-group-chevron"
            :class="{ 'is-expanded': !isGroupCollapsed(group.key) }"
            :size="14"
            :stroke-width="1.8"
          />
          <span>{{ group.name }}</span>
          <small>{{ group.projects.length }}</small>
        </button>

        <div v-show="!isGroupCollapsed(group.key)" class="project-group-items">
          <div
            v-for="project in group.projects"
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
        </div>
      </section>
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
        <label for="project-group">Group</label>
        <el-input
          id="project-group"
          v-model="groupName"
          maxlength="128"
          placeholder="Optional group name"
          clearable
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
