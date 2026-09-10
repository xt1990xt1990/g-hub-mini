# G502 X Mini

轻量的 G502 X DPI / 板载档位工具。原生 HTML、CSS、JavaScript，无运行时依赖、无后台、无安装包。

在线使用：https://xt1990xt1990.github.io/g-hub-mini/

## 使用

1. 使用桌面 Chrome / Edge 打开网页，连接 G502 X 或接收器，点击「连接鼠标」并授权 HID 设备。
2. 输入 DPI 按回车，或选择预设来试用。试用会切换到主机模式；点击「恢复板载」或「断开连接」可恢复原本的板载模式。
3. 在手感测试区点击靶标，比较不同 DPI 下的命中率与点击间隔。它衡量的是点击表现，并不测量真实物理 DPI；系统鼠标加速会影响手感。
4. 编辑五个板载 DPI 档位，0 表示关闭。默认档位与狙击档位必须启用。「保存到鼠标」会写入所选配置并激活它。
5. 保存前自动将原始扇区备份到当前浏览器的本地存储，再写入并逐字节回读验证。下载按钮导出备份；恢复按钮恢复**本次连接时**所选配置的 DPI 字段。浏览器存储中也保留首次备份及最近写入前备份，导出时一并包含。暂不支持导入备份文件。
6. 断电重连，确认板载设置保留。没有鼠标时点击「演示」试用页面；演示数值不会影响真实鼠标速度。

## 验证状态与范围

**尚未进行 G502 X 实机验证。** 已实现基于公开 HID++ 协议的读取、即时 DPI 设置、板载写入与校验，并提供模拟 HID 设备测试。能否通过你的接收器连接、固件是否接受命令、断电后能否保留，需要接入实机确认。

仅连接名称匹配 G502 X 的设备。支持 HID++ 0x2201、0x8100；板载写入限定 memory model 1、profile format 1/2/3/5、256 字节扇区及有效 CRC 的现有启用用户配置。不创建/删除配置，不修改按键、灯效或宏。保留原始扇区其他字节，只修改默认/狙击索引、5 个 DPI 和 CRC。

即时模式关闭网页时无法可靠异步恢复设备，因此关闭前请点击「恢复板载」或「断开连接」。通信超时后要求重新连接，不会自动重复写入。

通信与备份都在本机完成，无遥测或数据上传。GitHub Pages 仅提供静态网页文件。

## 本地运行

需要 Node.js 20 或更新版本，无需 npm install：

```sh
npm start
# 打开 http://localhost:5173
npm test
```

GitHub Pages 直接发布 `main` 分支的 `docs/`，不需要构建流程。在仓库 Settings → Pages 中选择 Deploy from a branch，分支 main，目录 /docs。发布更新前运行 `npm test`。

## 协议参考

- [G-Web](https://github.com/yume-chan/g-web)：WebHID / HID++ 连接和即时 DPI 思路。
- [Solaar](https://github.com/pwr-Solaar/Solaar/blob/master/lib/logitech_receiver/hidpp20.py)：板载格式、扇区读写、DPI 字段。
- [libratbag](https://github.com/libratbag/libratbag/blob/master/src/hidpp20.c)：G502 X profile format 0x05、写入序列、CRC-16/CCITT。

本项目独立实现协议。G502 X / Logitech 商标归相应所有者，本项目非官方。
