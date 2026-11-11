# Wallpaper Engine 背景

2026-10-24：背景导入支持 Wallpaper Engine 的图片、视频、场景与网页项目。

在首页“背景”或其他页面的“本页背景”中选择“从 Wallpaper Engine 导入”，选择壁纸目录中的 `project.json`。普通“选择图片 / 视频”的文件选择器也接受该 JSON。需要完整项目目录，单独复制 `project.json` 不包含画面资源。

| 项目类型 | 加载方式 |
| --- | --- |
| image / video | 沿用图片与视频媒体库 |
| scene | 使用 WebWallGL 3.0.0 在本地 WebGL2 中渲染，支持 `scene.pkg` 和松散场景目录 |
| web | 在沙箱中加载本地 HTML、脚本及资源 |
| application | 不执行应用程序壁纸 |

场景与网页导入会把项目目录复制到本机资料目录的 `backgrounds/wallpapers/<uuid>.wallpaper/`，不修改 Steam 原文件。单个项目限制 1 GB、10000 个文件。各页面的背景设置独立保存，原有图片和视频设置保持兼容。

动态背景默认静音、最高 30 fps，可调整遮罩、模糊、铺满/完整显示和暂停。离开页面会销毁对应壁纸实例；窗口隐藏时暂停。当前没有接入系统音频、麦克风或正在播放的媒体信息。

2026-11-11：Windows 使用软件视频解码，修复部分 4K H.264 视频壁纸播放约两秒后出现 `PIPELINE_ERROR_DISCONNECTED` 并回退工作室背景的问题。WebGL 场景和界面仍使用 GPU 渲染；高分辨率视频的 CPU 占用可能增加。

2026-10-26：新增按页面保存的“跟随系统减少动态效果”，默认开启。关闭后，该页面可在系统关闭动画的情况下照常播放动态背景；手动暂停和窗口隐藏暂停仍生效。设置字段为 `respectReducedMotion`，旧资料缺省按 `true` 读取。

遵循系统偏好时，有 `project.preview` 的场景使用项目预览图作为静态画面；GIF 预览只绘制一帧，不继续播放，避免把场景暂停在黑色开场动画。手动暂停后重新打开页面也可显示此静态预览，已运行的场景手动暂停时保留当前帧。预览和场景均留在原有隔离 iframe 中。

壁纸在 `hivelab-wallpaper:` 专用协议内加载，外层 iframe 使用 `sandbox="allow-scripts"`，不提供主界面的 preload、账号接口、Node 权限或外网连接。场景脚本仅在此渲染区域运行。WebWallGL 在不允许持久 CacheStorage 的沙箱中使用内存缓存；主界面的 CSP 没有开放动态脚本求值权限。

WebWallGL 为独立兼容渲染器，部分 Wallpaper Engine 特效、脚本或媒体格式可能存在差异。网页壁纸需要外部网络资源时，这些资源不会在当前离线沙箱中加载。加载失败时回到默认工作室背景。

验证：`tests/background.test.ts`、`tests/wallpaper-electron-smoke.mjs`。`npm run verify` 包含生成的本地网页/场景测试。使用本机已拥有的项目额外验证：

```powershell
$env:HIVELAB_WALLPAPER_PROJECT = 'E:\steam\steamapps\workshop\content\431960\3288381550\project.json'
node --import ./scripts/test-bootstrap.mjs --import tsx scripts/desktop-smoke.mjs tests/wallpaper-electron-smoke.mjs
```

该验证使用隔离资料，不调用模型，不把壁纸资源放进源码仓库或分发包。对上述项目已验证首帧、13 图层、10 组粒子、画面变化及暂停稳定性。

视频解码回归可设置 `HIVELAB_WALLPAPER_VIDEO` 为本地视频路径，再运行同一个冒烟测试；它会检查持续播放超过原先约两秒的故障点，以及重载后手动暂停仍生效。未设置时使用仓库内的 WebM 测试视频。

对 `3436945972`（麻匪 Wlop 远方来客，102 图层）额外验证了系统减少动态效果开启时的静态预览、明确播放选择跨重启保留、越过黑色开场后的真实画布像素以及手动暂停。自动化检查必须主动设置 `reducedMotion:'reduce'`；Playwright 默认媒体偏好会掩盖这一类普通启动问题。实际日常版另以延后连接调试接口的方式读取系统原始偏好。

代码依赖许可与源码位置已加入 `public/third-party-licenses.txt`：WebWallGL 为 MIT，Mediabunny 为 MPL-2.0。未修改第三方库源码；运行程序依赖目录包含对应原始源码。

参考：[Wallpaper Engine 网页项目文档](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html)、[WebWallGL 上游](https://github.com/oneincase/webwallgl)。
