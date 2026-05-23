import { Command } from "commander";

type HelloOptions = {
  upper?: boolean;
};

export function createHelloCommand(): Command {
  return new Command("hello")
    .description("输出一个示例问候语。")
    .argument("[name]", "要问候的名字", "world")
    .option("-u, --upper", "把输出转换为大写")
    .action((name: string, options: HelloOptions) => {
      const message = `Hello, ${name}!`;
      console.log(options.upper ? message.toUpperCase() : message);
    });
}
