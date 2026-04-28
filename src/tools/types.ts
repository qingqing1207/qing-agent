// 工具输入参数的基础 JSON 对象类型。
export type JsonObject = Record<string, unknown>

// 暴露给模型看的工具输入 JSON Schema。
// 内部保持 camelCase，转换给 Anthropic API 时再映射成 input_schema。
export type ToolInputSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

// 工具执行时需要的上下文。
// 当前只包含 workspace 根目录，后续可以扩展权限、配置等信息。
export type ToolContext = {
  cwd: string
}

// 工具执行后的内部结果。
// isError 表示这是一次失败结果，但仍会作为 tool_result 返回给模型。
export type ToolCallResult = {
  content: string
  isError?: boolean
}

// 项目内部统一的工具契约。
// 每个工具同时提供模型可见的描述/schema，以及本地执行函数。
export type AgentTool = {
  name: string
  description: string
  inputSchema: ToolInputSchema
  isReadOnly(): boolean
  isEnabled(context?: ToolContext): boolean
  call(input: JsonObject, context: ToolContext): Promise<ToolCallResult>
}
