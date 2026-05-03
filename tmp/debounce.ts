/**
 * 防抖函数
 * 连续触发事件时，只在最后一次触发后等待 delay 毫秒才执行回调
 *
 * @param fn 要执行的回调函数
 * @param delay 延迟时间（毫秒），默认 300ms
 * @param immediate 是否立即执行第一次触发，默认为 false
 * @returns 防抖处理后的函数
 */
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number = 300,
  immediate: boolean = false
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>): void {
    const context = this;

    if (timer !== null) {
      clearTimeout(timer);
    }

    if (immediate) {
      // 立即执行模式：第一次触发立即执行，之后在 delay 内不再触发
      const callNow = !timer;
      timer = setTimeout(() => {
        timer = null;
      }, delay);

      if (callNow) {
        fn.apply(context, args);
      }
    } else {
      // 非立即执行模式：等待 delay 毫秒后执行
      timer = setTimeout(() => {
        fn.apply(context, args);
        timer = null;
      }, delay);
    }
  };
}

// ========== 使用示例 ==========
// 普通防抖
// const handleInput = debounce((value: string) => {
//   console.log('输入值：', value);
// }, 500);

// 立即执行模式（第一次立即触发）
// const handleClick = debounce(() => {
//   console.log('按钮点击（首次立即执行）');
// }, 300, true);

// 在浏览器中使用
// inputElement.addEventListener('input', (e) => {
//   handleInput((e.target as HTMLInputElement).value);
// });

export default debounce;
