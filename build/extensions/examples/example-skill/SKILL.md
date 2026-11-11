---
name: example-skill
description: 当用户明确要求“使用 example-skill 整理任务”时，将当前任务压缩成目标、现状、下一步三项。
---

# 整理任务示例

读取当前对话，输出“目标”“现状”“下一步”三项，每项一句。
需要格式示例时，通过 read_skill_asset 读取 references/template.md。
这个技能不赋予网络、文件写入、电脑控制或消息发送权限。
