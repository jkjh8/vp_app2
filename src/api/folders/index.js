import { logger } from '../../logger/index.js'
import { dbFolders, dbFiles } from '../../db/index.js'

// 논리(메타데이터) 폴더 계층. 실제 파일은 디스크상 UUID 버킷에 그대로 유지되고,
// 폴더는 parentId 참조로만 트리를 구성한다. 파일은 folderId(null=루트)로 소속을 가진다.

// HTTP 상태코드를 실어 던지는 에러 (라우트에서 매핑)
const httpError = (status, message) => {
  const err = new Error(message)
  err.status = status
  return err
}

const normalizeParentId = (parentId) =>
  parentId === undefined || parentId === null || parentId === '' ? null : parentId

// 형제(같은 parentId) 중 대소문자 무시 이름 중복 검사. excludeId는 이름변경 시 자기 자신 제외.
const assertNameAvailable = async (name, parentId, excludeId = null) => {
  const siblings = await dbFolders.find({ parentId })
  const target = name.trim().toLowerCase()
  const clash = siblings.some(
    (f) => f._id !== excludeId && String(f.name).trim().toLowerCase() === target,
  )
  if (clash) throw httpError(409, '같은 위치에 동일한 이름의 폴더가 이미 있습니다.')
}

const getFolders = async () => {
  return await dbFolders.find({})
}

const createFolder = async ({ name, parentId } = {}) => {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw httpError(400, '폴더 이름을 입력하세요.')
  const parent = normalizeParentId(parentId)
  if (parent !== null) {
    const exists = await dbFolders.findOne({ _id: parent })
    if (!exists) throw httpError(404, '상위 폴더를 찾을 수 없습니다.')
  }
  await assertNameAvailable(trimmed, parent)
  const doc = await dbFolders.insert({ name: trimmed, parentId: parent })
  return doc
}

const renameFolder = async (id, name) => {
  const trimmed = (name ?? '').trim()
  if (!trimmed) throw httpError(400, '폴더 이름을 입력하세요.')
  const folder = await dbFolders.findOne({ _id: id })
  if (!folder) throw httpError(404, '폴더를 찾을 수 없습니다.')
  await assertNameAvailable(trimmed, folder.parentId ?? null, id)
  await dbFolders.update({ _id: id }, { $set: { name: trimmed } }, {})
  return { ...folder, name: trimmed }
}

// 대상 폴더 + 모든 자손 폴더를 재귀 삭제. 포함된 파일은 루트로 재배치(folderId=null).
// 미디어/dbFiles 문서 자체는 절대 삭제하지 않는다.
const deleteFolderRecursive = async (id) => {
  const folder = await dbFolders.findOne({ _id: id })
  if (!folder) throw httpError(404, '폴더를 찾을 수 없습니다.')

  const all = await dbFolders.find({})
  const childrenOf = new Map()
  for (const f of all) {
    const p = f.parentId ?? null
    if (!childrenOf.has(p)) childrenOf.set(p, [])
    childrenOf.get(p).push(f._id)
  }

  // BFS로 id + 자손 수집
  const ids = []
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()
    ids.push(cur)
    const kids = childrenOf.get(cur) || []
    queue.push(...kids)
  }

  const movedFiles = await dbFiles.update(
    { folderId: { $in: ids } },
    { $set: { folderId: null } },
    { multi: true },
  )
  const deletedFolders = await dbFolders.remove({ _id: { $in: ids } }, { multi: true })
  logger.info(`Folder deleted: ${deletedFolders} folder(s), ${movedFiles} file(s) moved to root`)
  return { deletedFolders, movedFiles }
}

export { getFolders, createFolder, renameFolder, deleteFolderRecursive, normalizeParentId }
