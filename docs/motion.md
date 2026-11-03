# 动效规范 · Motion

> Token 唯一来源：`src/App.css`（`--motion-*` / `--ease-*`）
> 验收脚本：`scripts/motion_check.mjs`
> 关联：`docs/design-system.md`（静态视觉）、`docs/design-system.html`（可视化）

---

## 1. 这份文件管什么

它回答三件事：

1. 哪些组件该有动效、哪些**故意不做**；
2. 每个组件的进入 / 退出 / 状态切换分别长什么样；
3. 怎么证明它真的在动 —— 而不是"我看着挺顺"。

默认前提：这是 Windows 桌面应用。浮层、转场、列表要像系统的一部分——克制、不表演；**按压反馈自决策 59 起走弹性回弹**（用户拍板的"网页手感"）。两套口味并存，范围以 §3 的表为准。

---

## 2. 度量：五档时长，三条曲线

| 档位 | 时长 | Token | 曲线 | 用于 |
|---|---|---|---|---|
| fast | 120ms | `--motion-fast` | `ease-standard` | 悬停、按下跟手、焦点环、关闭按钮 |
| base | 180ms | `--motion-base` | `ease-standard` | 状态切换、遮罩淡入、堆叠让位 |
| slow | 240ms | `--motion-slow` | `ease-standard` | 浮层入场（弹窗、Toast） |
| exit | 160ms | `--motion-exit` | `ease-exit` | 所有浮层退场 |
| spring | 320ms | `--motion-spring` | `ease-spring` | 弹性回弹：开关滑块位移、对勾入场、按钮松开回弹（决策 59） |

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);  /* 快起慢收，Windows 的手感 */
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);  /* 加速离开，读起来是"撤走" */
--ease-spring:   cubic-bezier(0.34, 1.56, 0.64, 1);  /* 终点前过冲 ~10% 再收回，弹而不闹 */
```

**spring 档的用法约束（决策 59）**：只给「看得见的行程」用——位移（滑块 20px）与形状（对勾 0→1）。颜色不用它：320ms 的 hover 变色显得反应慢，颜色一律 fast。已定义的 `--ease-emphasized`（过冲仅 ~2%）对可见行程太弱，维持定义但不使用。

**为什么退场要单独一档、而且更短**：入场是"请你看"，可以慢；退场是"别挡路"，越拖越像卡住。退场比入场快 1/3，观感上才是干净地消失。

**位移与缩放的上限**：位移 ≤ 8px，缩放 0.96–1.0。超过这个量级，桌面端会显得轻浮；缩放过度会让文字发虚。spring 的过冲不受此限——它是回弹的一部分，滑块过冲 ~2px、对勾峰值 ~1.1 都在"弹一下"的量级。

**硬规则**：组件里只写 `duration-(--motion-*)` 和 `ease-standard` / `ease-exit` / `ease-spring`。禁止 `duration-200` 这类裸数字，也禁止 `transition-all`。按钮按压的两段曲线（按下 fast、松开 spring）一条 Tailwind 声明写不出，集中在 App.css 的 `motion-press`（见 §4.4）。

**JS 侧例外有二**（CSS transition/keyframes 表达不了的才允许 JS）：

1. **Toast 倒计时条**——它是剩余时间的**读数**，不是装饰性动效：
   - 时长 = 该条 toast 的超时（3.2–6s），由组件内联 `animation-duration` 注入 —— 是数据不是档位；
   - 缓动必须 `linear`：ease 会让"剩余多少"的读数失真（同样一格长度代表的秒数前后不一致）。
   实现见 `src/App.css` 的 `toast-countdown`，挂起同步见 `src/components/ui/toaster.tsx`。
2. **按压水滴（决策 60）**——涟漪要按点击坐标定位、水珠晃动是多周期衰减振荡，单段贝塞尔曲线表达不了：
   - 实现见 `src/components/ui/press-water.ts`（全局委托，凡 `button.motion-press` 都覆盖）；
   - 与 Toast FLIP 同级的一次性 WAAPI 补间，非常驻逐帧 JS；`prefers-reduced-motion` 下在 JS 侧直接跳过。

---

## 3. 动画化的组件范围

### 做

| 组件 | 进入 | 退出 | 状态切换 |
|---|---|---|---|
| **开屏遮罩 SplashOverlay（决策 58）** | 整层即现盖满窗口，logo 缩放 0.96→1 + 淡入 240ms（`splash-in`）；「停留多久」是启动编排不是动效（最短 800ms / 减少动态 0 / 兜底 5s，组件计时器管） | 数据就绪整层淡出 240ms ease-exit，`transitionend` 后卸载 | — |
| **Toast** | 下方 8px 起、缩放 0.96→1、淡入，240ms，原点在右下 | 下沉 4px、缩到 0.98、淡出，160ms | 堆叠让位 180ms（FLIP）；关闭按钮悬停 120ms；倒计时条随剩余寿命 linear 缩短，悬停/失焦与计时器同挂起（§2 例外） |
| **AlertDialog 遮罩** | 淡入 180ms | 淡出 160ms | — |
| **AlertDialog 弹窗** | 缩放 0.96→1 + 淡入，240ms，中心原点 | 缩回 0.96 + 淡出，160ms | — |
| **Button** | — | — | 悬停/焦点 120ms；按下 scale 0.97 + 1px 位移（120ms 跟手）；松开 scale 水珠晃动：衰减振荡 0.97→1.02→0.993→1.004→1（480ms WAAPI，决策 60）；按下荡开涟漪（500ms 淡出，WAAPI，决策 60）；禁用不参与 |
| **Toggle（开关滑块）** | — | — | 滑块位移 320ms ease-spring（过冲 ~2px 回位，决策 59）；轨道颜色 120ms |
| **Checkbox** | — | — | 框颜色 120ms；对勾/横线入场 `check-pop`：scale 0→1 + ease-spring（峰值 ~1.1，决策 59）；取消勾选即卸载、无退场 |
| **Input** | — | — | 焦点环与描边 120ms；错误态同档 |
| **ThemeCard** | — | — | 悬停/选中 180ms（ring 宽度用 box-shadow 插值，不会"跳粗"）；按下 1px |
| **侧栏导航** | — | — | 复用 Button 变体，120ms；当前项 `aria-current` |
| **Badge** | — | — | 颜色 120ms（只跟随状态色，不承载主操作） |
| **列表：骨架 → 内容** | 整体淡入 180ms（`enter-fade`） | — | — |
| **视图切换**（图库 / 我的主题 / 最近使用） | 内容区整体淡入 180ms（`enter-fade`），不做位移与缩放 | — | — |
| **设置分组切换**（通用 / 快捷键 / 数据 / 系统集成 / 关于） | 内容区整体淡入 180ms（`enter-fade`，`key=分组` 触发重挂），与换页同一套口径 | — | — |
| **检查器换选中项** | 整体淡入 180ms（`enter-fade`，`key=主题 ID` 触发重挂） | — | — |
| **详情区首次出现** | 整体淡入 180ms | — | — |

### 不做（附理由）

| 项 | 为什么不加 |
|---|---|
| 页面 / 路由转场 | 换页只做 180ms 淡入，**不做位移与缩放**：骨架三栏不动，滑动进场会让人以为整块界面在重排 |
| 光标槽位卡 hover | 它不可点。加 hover 反馈等于骗用户去点 |
| 光标预览图入场 | 每次切主题都播会晃眼；`.ani` 本身逐帧播放已经是动态的 |
| 列表逐项 stagger | 15 个槽位依次淡入会把等待感拉长，属于"表演型动效" |
| 宽高 / 位置动画 | 触发布局重排，必然掉帧。高度变化一律交给 FLIP 的 transform |
| Toast 滑动手势 | base-ui 已经用 transform 跟随指针，接管反而会打架 |
| 面板拖拽补间 | 拖分隔条是直接操作，宽度必须跟手；补间会变成"拖完再滑一段"，反而更难对准 |
| 内容卡片按压弹性 | GalleryCard 等面积大，scale 变化显眼且与"卡片是内容不是控件"的定位不符，维持 180ms 标准过渡（决策 59） |
| 开关滑块 / 对勾的水珠晃动 | 开关要利落，多周期晃动显得拖泥带水；单次过冲回弹已够（决策 60） |
| 键盘激活的水滴 | 缩放反馈已有；涟漪从指针坐标来，键盘没有坐标，为中心补一套得不偿失（决策 60） |
| 滚动条进出场的动画 | 滚动条是系统画的，能调的只有宽度与配色；`gutter: stable` 已经消除了"出现滚动条把内容挤一下"的跳动 |
| 遮罩模糊动画 | 每帧 `backdrop-filter` 开销高，桌面端收益低 |

---

## 4. 实现要点

### 4.1 浮层：用 base-ui 的状态属性，而不是自己记开关

Base UI 的 Dialog / Toast 会在元素上打三个状态：

| 属性 | 出现时机 | 写法 |
|---|---|---|
| `data-starting-style` | 挂载后的第一帧 | 定义"从哪来"（opacity 0 / 缩放 0.96 / 下移 8px） |
| `data-ending-style` | 关闭后、卸载前 | 定义"到哪去" |
| `data-open` / 常态 | 稳定态 | 不写，靠默认值 |

```tsx
"transition-[opacity,scale] duration-(--motion-slow) ease-standard",
"data-[starting-style]:scale-96 data-[starting-style]:opacity-0",
"data-[ending-style]:scale-96 data-[ending-style]:opacity-0",
"data-[ending-style]:duration-(--motion-exit) data-[ending-style]:ease-exit",
```

**退场时长不能是 0**：base-ui 收到 `transitionend` 才卸载节点。写成 0 会收不到事件，浮层留在 DOM 里。所以 `prefers-reduced-motion` 的兜底也是压到 `0.01ms`，而不是 `0`。

**退场期间 `pointer-events: none`**：元素还要在 DOM 里待 160ms，不该继续吃点击。

### 4.2 Toast 堆叠让位：FLIP

toast 栈贴在右下角，**新的一条前插到栈顶**（base-ui 的行为），所以：

- 新增：已有几条的位置不变，**不需要**补间；
- 移除最旧一条：上面的整体落回 52px，**这里会跳**。

`src/components/ui/toaster.tsx` 的 `useStackShift` 在布局变化后量一次位置，用 WAAPI 把差值补回去：

```ts
el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
  duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)",
});
```

三个容易踩的点：

1. **位置 = `offsetParent` 的顶边 + `offsetTop`**。直接用 `getBoundingClientRect()` 会把元素自身的入场 translate 算进去；只看 `offsetTop` 又会漏掉容器的整体移动（容器贴底，变高时顶边上移）。
2. **补间前先 `cancel()` 上一轮**，否则量到的是动画中间态，误差会累积。
3. **跳过带 `data-starting-style` / `data-ending-style` 的项**，它们自己就在动，叠两套 transform 会互相覆盖。

### 4.3 状态切换：只动能不触发布局的属性

- ring 的粗细变化走 `box-shadow`（可插值），不要用 `border`（会重排，且 1px→2px 是硬跳）。
- 禁止 `transition-all`：它会把 `display`、宽高、`content-visibility` 一起卷进来。
- 父级 hover 影响子级时，把过渡写在**真正变化的元素**上。

### 4.4 按压弹性：两段曲线（决策 59）

按钮「按下跟手、松开回弹」是**两段不同时长/曲线**的过渡，一条 Tailwind 声明写不出（`duration-*`/`ease-*` 是统一值），所以集中在 `App.css` 的 `motion-press`（`@utility`）里管，`button.tsx` 只引用类名：

```css
@utility motion-press {
  transition: /* 颜色 + translate 全走 fast/standard，scale 走 spring */;
  &:active {
    scale: 0.97;
    transition: /* 全部走 fast/standard —— 按下要跟手 */;
  }
}
```

CSS 的规则是「变化发生时按**新状态**的 transition 定义走」，所以：按下=进入 `:active`，缩放用 fast 档跟手；松开=回到常态，scale 用 spring 档（320ms）过冲回弹。**方向不能反**——反了按下迟钝、松开突然。

三个配套点：

1. **颜色不跟 scale 一起弹**：`motion-press` 的 transition 列表里颜色各项固定 fast/standard，只有 `scale` 一项吃 spring。320ms 的悬停变色会显得反应慢。
2. **scale 是独立属性不是 `transform`**：与按下位移用的 `translate` 属性（`translate-y-px`）互不覆盖，两条过渡可以并存。
3. **滑块/对勾不需要两段**：Toggle 点击即切换、Checkbox 对勾挂载即播，没有「按下/松开」两态，一条 spring 过渡/动画就够。

### 4.5 按压水滴：涟漪 + 水珠晃动（决策 60）

用户在决策 59 的基础上要「水滴感」，落成两件叠在按钮上的反馈（`press-water.ts`）：

- **涟漪**：pointerdown 时在按钮内（`motion-press` 自带 `relative + overflow-hidden`）插入一个圆 span，从点击点 `scale 0→1 + opacity 0.22→0` 荡开 500ms，`finished` 后移除。颜色取 `currentColor`——default 按钮是白波、ghost/outline 是前景色波，一套代码全变体通用。
- **水珠晃动**：pointerup 后对按钮播 480ms 的衰减振荡 keyframes（`scale 0.97→1.02→0.993→1.004→1`）。松手不再走 §4.4 的单次 spring 回弹——WAAPI 动画优先于 transition，动画播完 CSS 已稳定在 1。

架构上是**全局委托**（`installPressWater()`，App 挂一份）：document 捕获 pointerdown，`closest('button.motion-press')` 命中才动。原因：侧栏导航等处是 `buttonVariants()` 类串配原生 `<button>`（要塞活动条等自定义结构），逐组件挂载会漏，类名即行为标记——凡 `motion-press` 就有水滴，未来变体自动获得。

约束：

- 晃动用独立 `scale` 属性的 keyframes，不碰 `transform`（避免覆盖按下位移的 translate）。
- 快速连点各自出涟漪（独立 span 独立动画），互不排队。
- 键盘激活不出水滴（没有坐标，见 §3 不做表）。

---

## 5. 可访问性

| 要求 | 做法 |
|---|---|
| 尊重系统"减少动态" | `App.css` 全局把 `animation-duration` / `transition-duration` 压到 0.01ms，并清零 `transition-delay`；FLIP 在 JS 侧直接跳过（`matchMedia`）；`.ani` 预览（`AniPlayer`）降级时只画首帧并停止定时器，系统设置切换时实时响应 |
| 焦点不能被延迟 | 焦点环走 120ms 档、颜色不透明；不做 `delay` |
| 无眩晕风险 | 位移 ≤ 8px、无旋转、无视差、无自动循环播放（`animate-pulse` 在降级下只播一轮） |
| 不阻断操作 | 浮层退场期间 `pointer-events: none`；动画不改变可点区域 |
| 不缩短阅读时间 | Toast 超时仍是 3.2s / 4s / 5s / 6s，动画时长不含在判断里；悬停暂停由 base-ui 负责，倒计时条与计时器同挂起，不会"条先走完"逼人快读 |
| 不用颜色单独表意 | 状态条 + 图标 + 文案三重表达，动效只是辅助 |

---

## 6. 性能

| 约束 | 说明 |
|---|---|
| 只动合成属性 | `opacity` / `translate` / `scale` / `transform`；`box-shadow` 仅用于小面积（按钮、卡片、输入框） |
| 不跑布局动画 | 高度变化交给 FLIP；不做 `height` / `top` / `margin` 过渡 |
| 并发上限 | Toast 最多 3 条；同一时刻最多一个弹窗 |
| 不做逐帧 JS | 除 Toast 的 FLIP 一次性补间外，全部交给 CSS |
| 无 `will-change` 常驻 | 过渡本身就会提升图层；常驻只会白占显存 |
| 无 `backdrop-filter` 动画 | 模糊每帧重算，桌面低端机直接掉帧 |

---

## 7. 验收

```bash
node scripts/dev_bg.mjs start && node scripts/motion_check.mjs; node scripts/dev_bg.mjs stop
```

必须和 dev server 写在同一条命令里 —— 跨命令的 dev server 会被回收。

脚本逐帧采样，而不是单点截图，断言 47 项：

- Toast 入场/退场：是否真的在过渡、时长、中间态、位移、结束是否卸载；
- Toast 倒计时条：时长是否等于该条超时、是否随时间缩短、悬停是否真冻结、移开是否继续；
- Dialog 弹窗与遮罩：同上，且遮罩比弹窗快一档；
- Toast 让位：是否触发 FLIP、时长 180ms；
- `prefers-reduced-motion`：时长是否被压到近似 0、是否跳过 FLIP、倒计时条是否不显示；
- 控件：按钮 120ms、主题卡 180ms 且走 `box-shadow`；
- 按压弹性（决策 59）：按钮过渡含 320ms spring 段、真实鼠标按下缩到 0.97；
- 按压水滴（决策 60）：真实鼠标按下荡开涟漪（`[data-ripple]` 出现、500ms 后移除）、松开水珠晃动（过冲 > 1.01、越过原尺寸后下穿再回 1）、减少动态下不产生涟漪；
- 开关滑块 320ms spring、切换越过终点（过冲 22px）后回位；对勾播 `check-pop`、过冲（scale > 1.05）后回位到 1；
- 运行期无 JS 异常。

改完动效，这条 + `design_check.mjs` 都绿才算完成。

---

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-11-03 | 按压水滴（决策 60）：用户要「水滴感」，涟漪从「不做」翻案——按下荡开涟漪 + 松开水珠衰减晃动（`press-water.ts` 全局委托，凡 `motion-press` 按钮都覆盖）；JS 例外区从一条改两条；开关滑块/对勾维持单次回弹；`motion_check` 43→47 项 |
| 2026-11-03 | 按压弹性（决策 59）：新增第五档 `--motion-spring`(320ms) 与 `--ease-spring` 曲线；Button 按下 scale 0.97 + 松开回弹（App.css `motion-press` 两段曲线，§4.4）、Toggle 滑块 spring 位移、Checkbox 对勾 `check-pop` 入场；涟漪与内容卡片按压列入「不做」；硬规则 ease 家族 +1；`motion_check` 33→43 项 |
| 2026-11-02 | 开屏遮罩（决策 58）：logo 入场 `splash-in` 与整层退场全走既有四档 token，无新档位、无例外；「停留时长是启动编排不是动效」的口径记入 §3 |
| 2026-10-25 | `AniPlayer` 接入 `prefers-reduced-motion`：降级只画首帧、监听系统设置变化；恢复后继续播放（决策 20） |
| 2026-10-24 | Toast 倒计时条：贴卡片底边 scaleX 1→0（时长=超时、linear —— §2 唯一例外）；挂起与 base-ui 计时器同进退（data-expanded + 窗口焦点镜像）；`motion_check` 增至 33 项断言 |
| 2026-10-21 | 建立。四档时长（fast/base/slow/exit）、两条曲线；Toast 与 Dialog 补齐进入/退出；Toast 堆叠 FLIP；`transition-all` 清零；新增 `motion_check.mjs`（28 项断言） |
