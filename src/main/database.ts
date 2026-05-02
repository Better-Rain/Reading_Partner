import initSqlJs, { Database as SqlDatabase, SqlValue } from 'sql.js'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import {
  AIProviderRecord,
  AnnotationRecord,
  CreateAnnotationInput,
  DocumentRecord,
  UpsertAIProviderInput
} from '../shared/types'

const now = (): string => new Date().toISOString()
const require = createRequire(import.meta.url)

type DocumentRow = {
  id: string
  title: string
  file_path: string
  file_size: number
  page_count: number | null
  created_at: string
  last_opened_at: string
}

type AnnotationRow = {
  id: string
  document_id: string
  type: AnnotationRecord['type']
  page_number: number
  selected_text: string | null
  color: string | null
  note: string | null
  rects_json: string | null
  created_at: string
  updated_at: string
}

type AIProviderRow = {
  id: string
  label: string
  base_url: string
  default_model: string
  api_key_ref: string | null
  supports_thinking: 0 | 1
  supports_long_context: 0 | 1
  enabled: 0 | 1
  updated_at: string
}

const toDocument = (row: DocumentRow): DocumentRecord => ({
  id: row.id,
  title: row.title,
  filePath: row.file_path,
  fileSize: row.file_size,
  pageCount: row.page_count,
  createdAt: row.created_at,
  lastOpenedAt: row.last_opened_at
})

const toAnnotation = (row: AnnotationRow): AnnotationRecord => ({
  id: row.id,
  documentId: row.document_id,
  type: row.type,
  pageNumber: row.page_number,
  selectedText: row.selected_text,
  color: row.color,
  note: row.note,
  rectsJson: row.rects_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const toAIProvider = (row: AIProviderRow): AIProviderRecord => ({
  id: row.id,
  label: row.label,
  baseUrl: row.base_url,
  defaultModel: row.default_model,
  apiKeyRef: row.api_key_ref,
  supportsThinking: row.supports_thinking === 1,
  supportsLongContext: row.supports_long_context === 1,
  enabled: row.enabled === 1,
  updatedAt: row.updated_at
})

export class ReadingPartnerDatabase {
  private constructor(
    private readonly db: SqlDatabase,
    private readonly databasePath: string
  ) {}

  static async open(databasePath: string): Promise<ReadingPartnerDatabase> {
    mkdirSync(dirname(databasePath), { recursive: true })
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    })
    const db = existsSync(databasePath)
      ? new SQL.Database(readFileSync(databasePath))
      : new SQL.Database()
    const store = new ReadingPartnerDatabase(db, databasePath)

    store.db.run('pragma foreign_keys = ON')
    store.migrate()
    store.seedProviders()
    store.persist()

    return store
  }

  listDocuments(): DocumentRecord[] {
    const rows = this.query<DocumentRow>('select * from documents order by last_opened_at desc')
    return rows.map(toDocument)
  }

  getDocument(id: string): DocumentRecord {
    const row = this.get<DocumentRow>('select * from documents where id = ?', [id])

    if (!row) {
      throw new Error(`Document not found: ${id}`)
    }

    return toDocument(row)
  }

  importDocument(filePath: string): DocumentRecord {
    const fileStat = statSync(filePath)
    const title = filePath.split(/[\\/]/).at(-1) ?? 'Untitled PDF'
    const existing = this.db
      .prepare('select * from documents where file_path = ?')
      .get(filePath) as DocumentRow | undefined
    const timestamp = now()

    if (existing) {
      this.db.run('update documents set file_size = ?, last_opened_at = ? where id = ?', [
        fileStat.size,
        timestamp,
        existing.id
      ])
      this.persist()

      return this.getDocument(existing.id)
    }

    const id = randomUUID()

    this.db.run(
      `insert into documents (
          id, title, file_path, file_size, page_count, created_at, last_opened_at
        ) values (?, ?, ?, ?, ?, ?, ?)`,
      [id, title, filePath, fileStat.size, null, timestamp, timestamp]
    )
    this.persist()

    return this.getDocument(id)
  }

  listAnnotations(documentId: string): AnnotationRecord[] {
    const rows = this.query<AnnotationRow>(
      `select * from annotations
         where document_id = ?
         order by page_number asc, created_at asc`,
      [documentId]
    )

    return rows.map(toAnnotation)
  }

  createAnnotation(input: CreateAnnotationInput): AnnotationRecord {
    const id = randomUUID()
    const timestamp = now()

    this.db.run(
      `insert into annotations (
          id, document_id, type, page_number, selected_text, color, note, rects_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.documentId,
        input.type,
        input.pageNumber,
        input.selectedText ?? null,
        input.color ?? null,
        input.note ?? null,
        input.rectsJson ?? null,
        timestamp,
        timestamp
      ]
    )
    this.persist()

    const row = this.get<AnnotationRow>('select * from annotations where id = ?', [id])
    if (!row) {
      throw new Error(`Annotation not found after insert: ${id}`)
    }
    return toAnnotation(row)
  }

  deleteAnnotation(id: string): void {
    this.db.run('delete from annotations where id = ?', [id])
    this.persist()
  }

  listAIProviders(): AIProviderRecord[] {
    const rows = this.query<AIProviderRow>(
      'select * from ai_providers order by enabled desc, label asc'
    )
    return rows.map(toAIProvider)
  }

  upsertAIProvider(input: UpsertAIProviderInput): AIProviderRecord {
    const timestamp = now()

    this.db.run(
      `insert into ai_providers (
          id, label, base_url, default_model, api_key_ref,
          supports_thinking, supports_long_context, enabled, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          label = excluded.label,
          base_url = excluded.base_url,
          default_model = excluded.default_model,
          api_key_ref = excluded.api_key_ref,
          supports_thinking = excluded.supports_thinking,
          supports_long_context = excluded.supports_long_context,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at`,
      [
        input.id,
        input.label,
        input.baseUrl,
        input.defaultModel,
        input.apiKeyRef ?? null,
        input.supportsThinking ? 1 : 0,
        input.supportsLongContext ? 1 : 0,
        input.enabled === false ? 0 : 1,
        timestamp
      ]
    )
    this.persist()

    const row = this.get<AIProviderRow>('select * from ai_providers where id = ?', [input.id])
    if (!row) {
      throw new Error(`AI provider not found after upsert: ${input.id}`)
    }
    return toAIProvider(row)
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists documents (
        id text primary key,
        title text not null,
        file_path text not null unique,
        file_size integer not null,
        page_count integer,
        created_at text not null,
        last_opened_at text not null
      );

      create table if not exists annotations (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        type text not null check(type in ('highlight', 'note', 'bookmark')),
        page_number integer not null,
        selected_text text,
        color text,
        note text,
        rects_json text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_annotations_document_page
        on annotations(document_id, page_number);

      create table if not exists ai_providers (
        id text primary key,
        label text not null,
        base_url text not null,
        default_model text not null,
        api_key_ref text,
        supports_thinking integer not null default 0,
        supports_long_context integer not null default 0,
        enabled integer not null default 1,
        updated_at text not null
      );

      create table if not exists ai_artifacts (
        id text primary key,
        document_id text not null references documents(id) on delete cascade,
        annotation_id text references annotations(id) on delete set null,
        provider_id text not null,
        model text not null,
        prompt_type text not null,
        input_text text not null,
        output_markdown text not null,
        page_number integer,
        created_at text not null
      );

      create table if not exists vocabulary (
        id text primary key,
        document_id text references documents(id) on delete set null,
        word text not null,
        definition text not null,
        source_sentence text,
        page_number integer,
        created_at text not null
      );
    `)
  }

  private seedProviders(): void {
    const count = this.get<{ count: number }>('select count(*) as count from ai_providers')

    if (count && count.count > 0) {
      return
    }

    const providers: UpsertAIProviderInput[] = [
      {
        id: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-v4-flash',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'qwen',
        label: 'Alibaba Bailian / Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen3.5-flash',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'kimi',
        label: 'Kimi / Moonshot',
        baseUrl: 'https://api.moonshot.ai/v1',
        defaultModel: 'kimi-k2-0905-preview',
        supportsThinking: true,
        supportsLongContext: true
      },
      {
        id: 'zhipu',
        label: 'Zhipu GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModel: 'glm-4.5-flash',
        supportsThinking: true,
        supportsLongContext: false
      }
    ]

    for (const provider of providers) {
      this.upsertAIProvider(provider)
    }
  }

  private persist(): void {
    writeFileSync(this.databasePath, this.db.export())
  }

  private get<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.query<T>(sql, params)[0]
  }

  private query<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql, params)
    const rows: T[] = []

    try {
      while (statement.step()) {
        rows.push(statement.getAsObject() as T)
      }
    } finally {
      statement.free()
    }

    return rows
  }
}
