#!/usr/bin/env node
import { createRequire as __alranCreateRequire } from "node:module"; const require = __alranCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/error.js
var require_error = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/error.js"(exports) {
    var CommanderError2 = class extends Error {
      /**
       * Constructs the CommanderError class
       * @param {number} exitCode suggested exit code which could be used with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       */
      constructor(exitCode, code, message) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.code = code;
        this.exitCode = exitCode;
        this.nestedError = void 0;
      }
    };
    var InvalidArgumentError2 = class extends CommanderError2 {
      /**
       * Constructs the InvalidArgumentError class
       * @param {string} [message] explanation of why argument is invalid
       */
      constructor(message) {
        super(1, "commander.invalidArgument", message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
      }
    };
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/argument.js
var require_argument = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/argument.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Argument2 = class {
      /**
       * Initialize a new command argument with the given name and description.
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @param {string} name
       * @param {string} [description]
       */
      constructor(name, description) {
        this.description = description || "";
        this.variadic = false;
        this.parseArg = void 0;
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.argChoices = void 0;
        switch (name[0]) {
          case "<":
            this.required = true;
            this._name = name.slice(1, -1);
            break;
          case "[":
            this.required = false;
            this._name = name.slice(1, -1);
            break;
          default:
            this.required = true;
            this._name = name;
            break;
        }
        if (this._name.length > 3 && this._name.slice(-3) === "...") {
          this.variadic = true;
          this._name = this._name.slice(0, -3);
        }
      }
      /**
       * Return argument name.
       *
       * @return {string}
       */
      name() {
        return this._name;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Argument}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Set the custom handler for processing CLI command arguments into argument values.
       *
       * @param {Function} [fn]
       * @return {Argument}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Only allow argument value to be one of choices.
       *
       * @param {string[]} values
       * @return {Argument}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Make argument required.
       *
       * @returns {Argument}
       */
      argRequired() {
        this.required = true;
        return this;
      }
      /**
       * Make argument optional.
       *
       * @returns {Argument}
       */
      argOptional() {
        this.required = false;
        return this;
      }
    };
    function humanReadableArgName(arg) {
      const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
      return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
    }
    exports.Argument = Argument2;
    exports.humanReadableArgName = humanReadableArgName;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/help.js
var require_help = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/help.js"(exports) {
    var { humanReadableArgName } = require_argument();
    var Help2 = class {
      constructor() {
        this.helpWidth = void 0;
        this.sortSubcommands = false;
        this.sortOptions = false;
        this.showGlobalOptions = false;
      }
      /**
       * Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
       *
       * @param {Command} cmd
       * @returns {Command[]}
       */
      visibleCommands(cmd) {
        const visibleCommands = cmd.commands.filter((cmd2) => !cmd2._hidden);
        const helpCommand = cmd._getHelpCommand();
        if (helpCommand && !helpCommand._hidden) {
          visibleCommands.push(helpCommand);
        }
        if (this.sortSubcommands) {
          visibleCommands.sort((a, b) => {
            return a.name().localeCompare(b.name());
          });
        }
        return visibleCommands;
      }
      /**
       * Compare options for sort.
       *
       * @param {Option} a
       * @param {Option} b
       * @returns {number}
       */
      compareOptions(a, b) {
        const getSortKey = (option) => {
          return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
        };
        return getSortKey(a).localeCompare(getSortKey(b));
      }
      /**
       * Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleOptions(cmd) {
        const visibleOptions = cmd.options.filter((option) => !option.hidden);
        const helpOption = cmd._getHelpOption();
        if (helpOption && !helpOption.hidden) {
          const removeShort = helpOption.short && cmd._findOption(helpOption.short);
          const removeLong = helpOption.long && cmd._findOption(helpOption.long);
          if (!removeShort && !removeLong) {
            visibleOptions.push(helpOption);
          } else if (helpOption.long && !removeLong) {
            visibleOptions.push(
              cmd.createOption(helpOption.long, helpOption.description)
            );
          } else if (helpOption.short && !removeShort) {
            visibleOptions.push(
              cmd.createOption(helpOption.short, helpOption.description)
            );
          }
        }
        if (this.sortOptions) {
          visibleOptions.sort(this.compareOptions);
        }
        return visibleOptions;
      }
      /**
       * Get an array of the visible global options. (Not including help.)
       *
       * @param {Command} cmd
       * @returns {Option[]}
       */
      visibleGlobalOptions(cmd) {
        if (!this.showGlobalOptions) return [];
        const globalOptions = [];
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          const visibleOptions = ancestorCmd.options.filter(
            (option) => !option.hidden
          );
          globalOptions.push(...visibleOptions);
        }
        if (this.sortOptions) {
          globalOptions.sort(this.compareOptions);
        }
        return globalOptions;
      }
      /**
       * Get an array of the arguments if any have a description.
       *
       * @param {Command} cmd
       * @returns {Argument[]}
       */
      visibleArguments(cmd) {
        if (cmd._argsDescription) {
          cmd.registeredArguments.forEach((argument) => {
            argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
          });
        }
        if (cmd.registeredArguments.find((argument) => argument.description)) {
          return cmd.registeredArguments;
        }
        return [];
      }
      /**
       * Get the command term to show in the list of subcommands.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandTerm(cmd) {
        const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
        return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + // simplistic check for non-help option
        (args ? " " + args : "");
      }
      /**
       * Get the option term to show in the list of options.
       *
       * @param {Option} option
       * @returns {string}
       */
      optionTerm(option) {
        return option.flags;
      }
      /**
       * Get the argument term to show in the list of arguments.
       *
       * @param {Argument} argument
       * @returns {string}
       */
      argumentTerm(argument) {
        return argument.name();
      }
      /**
       * Get the longest command term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestSubcommandTermLength(cmd, helper) {
        return helper.visibleCommands(cmd).reduce((max, command) => {
          return Math.max(max, helper.subcommandTerm(command).length);
        }, 0);
      }
      /**
       * Get the longest option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestOptionTermLength(cmd, helper) {
        return helper.visibleOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest global option term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestGlobalOptionTermLength(cmd, helper) {
        return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
          return Math.max(max, helper.optionTerm(option).length);
        }, 0);
      }
      /**
       * Get the longest argument term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      longestArgumentTermLength(cmd, helper) {
        return helper.visibleArguments(cmd).reduce((max, argument) => {
          return Math.max(max, helper.argumentTerm(argument).length);
        }, 0);
      }
      /**
       * Get the command usage to be displayed at the top of the built-in help.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandUsage(cmd) {
        let cmdName = cmd._name;
        if (cmd._aliases[0]) {
          cmdName = cmdName + "|" + cmd._aliases[0];
        }
        let ancestorCmdNames = "";
        for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
          ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
        }
        return ancestorCmdNames + cmdName + " " + cmd.usage();
      }
      /**
       * Get the description for the command.
       *
       * @param {Command} cmd
       * @returns {string}
       */
      commandDescription(cmd) {
        return cmd.description();
      }
      /**
       * Get the subcommand summary to show in the list of subcommands.
       * (Fallback to description for backwards compatibility.)
       *
       * @param {Command} cmd
       * @returns {string}
       */
      subcommandDescription(cmd) {
        return cmd.summary() || cmd.description();
      }
      /**
       * Get the option description to show in the list of options.
       *
       * @param {Option} option
       * @return {string}
       */
      optionDescription(option) {
        const extraInfo = [];
        if (option.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (option.defaultValue !== void 0) {
          const showDefault = option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean";
          if (showDefault) {
            extraInfo.push(
              `default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`
            );
          }
        }
        if (option.presetArg !== void 0 && option.optional) {
          extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
        }
        if (option.envVar !== void 0) {
          extraInfo.push(`env: ${option.envVar}`);
        }
        if (extraInfo.length > 0) {
          return `${option.description} (${extraInfo.join(", ")})`;
        }
        return option.description;
      }
      /**
       * Get the argument description to show in the list of arguments.
       *
       * @param {Argument} argument
       * @return {string}
       */
      argumentDescription(argument) {
        const extraInfo = [];
        if (argument.argChoices) {
          extraInfo.push(
            // use stringify to match the display of the default value
            `choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`
          );
        }
        if (argument.defaultValue !== void 0) {
          extraInfo.push(
            `default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`
          );
        }
        if (extraInfo.length > 0) {
          const extraDescripton = `(${extraInfo.join(", ")})`;
          if (argument.description) {
            return `${argument.description} ${extraDescripton}`;
          }
          return extraDescripton;
        }
        return argument.description;
      }
      /**
       * Generate the built-in help text.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {string}
       */
      formatHelp(cmd, helper) {
        const termWidth = helper.padWidth(cmd, helper);
        const helpWidth = helper.helpWidth || 80;
        const itemIndentWidth = 2;
        const itemSeparatorWidth = 2;
        function formatItem(term, description) {
          if (description) {
            const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
            return helper.wrap(
              fullText,
              helpWidth - itemIndentWidth,
              termWidth + itemSeparatorWidth
            );
          }
          return term;
        }
        function formatList(textArray) {
          return textArray.join("\n").replace(/^/gm, " ".repeat(itemIndentWidth));
        }
        let output = [`Usage: ${helper.commandUsage(cmd)}`, ""];
        const commandDescription = helper.commandDescription(cmd);
        if (commandDescription.length > 0) {
          output = output.concat([
            helper.wrap(commandDescription, helpWidth, 0),
            ""
          ]);
        }
        const argumentList = helper.visibleArguments(cmd).map((argument) => {
          return formatItem(
            helper.argumentTerm(argument),
            helper.argumentDescription(argument)
          );
        });
        if (argumentList.length > 0) {
          output = output.concat(["Arguments:", formatList(argumentList), ""]);
        }
        const optionList = helper.visibleOptions(cmd).map((option) => {
          return formatItem(
            helper.optionTerm(option),
            helper.optionDescription(option)
          );
        });
        if (optionList.length > 0) {
          output = output.concat(["Options:", formatList(optionList), ""]);
        }
        if (this.showGlobalOptions) {
          const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
            return formatItem(
              helper.optionTerm(option),
              helper.optionDescription(option)
            );
          });
          if (globalOptionList.length > 0) {
            output = output.concat([
              "Global Options:",
              formatList(globalOptionList),
              ""
            ]);
          }
        }
        const commandList = helper.visibleCommands(cmd).map((cmd2) => {
          return formatItem(
            helper.subcommandTerm(cmd2),
            helper.subcommandDescription(cmd2)
          );
        });
        if (commandList.length > 0) {
          output = output.concat(["Commands:", formatList(commandList), ""]);
        }
        return output.join("\n");
      }
      /**
       * Calculate the pad width from the maximum term length.
       *
       * @param {Command} cmd
       * @param {Help} helper
       * @returns {number}
       */
      padWidth(cmd, helper) {
        return Math.max(
          helper.longestOptionTermLength(cmd, helper),
          helper.longestGlobalOptionTermLength(cmd, helper),
          helper.longestSubcommandTermLength(cmd, helper),
          helper.longestArgumentTermLength(cmd, helper)
        );
      }
      /**
       * Wrap the given string to width characters per line, with lines after the first indented.
       * Do not wrap if insufficient room for wrapping (minColumnWidth), or string is manually formatted.
       *
       * @param {string} str
       * @param {number} width
       * @param {number} indent
       * @param {number} [minColumnWidth=40]
       * @return {string}
       *
       */
      wrap(str, width, indent, minColumnWidth = 40) {
        const indents = " \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF";
        const manualIndent = new RegExp(`[\\n][${indents}]+`);
        if (str.match(manualIndent)) return str;
        const columnWidth = width - indent;
        if (columnWidth < minColumnWidth) return str;
        const leadingStr = str.slice(0, indent);
        const columnText = str.slice(indent).replace("\r\n", "\n");
        const indentString = " ".repeat(indent);
        const zeroWidthSpace = "\u200B";
        const breaks = `\\s${zeroWidthSpace}`;
        const regex = new RegExp(
          `
|.{1,${columnWidth - 1}}([${breaks}]|$)|[^${breaks}]+?([${breaks}]|$)`,
          "g"
        );
        const lines = columnText.match(regex) || [];
        return leadingStr + lines.map((line, i) => {
          if (line === "\n") return "";
          return (i > 0 ? indentString : "") + line.trimEnd();
        }).join("\n");
      }
    };
    exports.Help = Help2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/option.js
var require_option = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/option.js"(exports) {
    var { InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var Option2 = class {
      /**
       * Initialize a new `Option` with the given `flags` and `description`.
       *
       * @param {string} flags
       * @param {string} [description]
       */
      constructor(flags, description) {
        this.flags = flags;
        this.description = description || "";
        this.required = flags.includes("<");
        this.optional = flags.includes("[");
        this.variadic = /\w\.\.\.[>\]]$/.test(flags);
        this.mandatory = false;
        const optionFlags = splitOptionFlags(flags);
        this.short = optionFlags.shortFlag;
        this.long = optionFlags.longFlag;
        this.negate = false;
        if (this.long) {
          this.negate = this.long.startsWith("--no-");
        }
        this.defaultValue = void 0;
        this.defaultValueDescription = void 0;
        this.presetArg = void 0;
        this.envVar = void 0;
        this.parseArg = void 0;
        this.hidden = false;
        this.argChoices = void 0;
        this.conflictsWith = [];
        this.implied = void 0;
      }
      /**
       * Set the default value, and optionally supply the description to be displayed in the help.
       *
       * @param {*} value
       * @param {string} [description]
       * @return {Option}
       */
      default(value, description) {
        this.defaultValue = value;
        this.defaultValueDescription = description;
        return this;
      }
      /**
       * Preset to use when option used without option-argument, especially optional but also boolean and negated.
       * The custom processing (parseArg) is called.
       *
       * @example
       * new Option('--color').default('GREYSCALE').preset('RGB');
       * new Option('--donate [amount]').preset('20').argParser(parseFloat);
       *
       * @param {*} arg
       * @return {Option}
       */
      preset(arg) {
        this.presetArg = arg;
        return this;
      }
      /**
       * Add option name(s) that conflict with this option.
       * An error will be displayed if conflicting options are found during parsing.
       *
       * @example
       * new Option('--rgb').conflicts('cmyk');
       * new Option('--js').conflicts(['ts', 'jsx']);
       *
       * @param {(string | string[])} names
       * @return {Option}
       */
      conflicts(names) {
        this.conflictsWith = this.conflictsWith.concat(names);
        return this;
      }
      /**
       * Specify implied option values for when this option is set and the implied options are not.
       *
       * The custom processing (parseArg) is not called on the implied values.
       *
       * @example
       * program
       *   .addOption(new Option('--log', 'write logging information to file'))
       *   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
       *
       * @param {object} impliedOptionValues
       * @return {Option}
       */
      implies(impliedOptionValues) {
        let newImplied = impliedOptionValues;
        if (typeof impliedOptionValues === "string") {
          newImplied = { [impliedOptionValues]: true };
        }
        this.implied = Object.assign(this.implied || {}, newImplied);
        return this;
      }
      /**
       * Set environment variable to check for option value.
       *
       * An environment variable is only used if when processed the current option value is
       * undefined, or the source of the current value is 'default' or 'config' or 'env'.
       *
       * @param {string} name
       * @return {Option}
       */
      env(name) {
        this.envVar = name;
        return this;
      }
      /**
       * Set the custom handler for processing CLI option arguments into option values.
       *
       * @param {Function} [fn]
       * @return {Option}
       */
      argParser(fn) {
        this.parseArg = fn;
        return this;
      }
      /**
       * Whether the option is mandatory and must have a value after parsing.
       *
       * @param {boolean} [mandatory=true]
       * @return {Option}
       */
      makeOptionMandatory(mandatory = true) {
        this.mandatory = !!mandatory;
        return this;
      }
      /**
       * Hide option in help.
       *
       * @param {boolean} [hide=true]
       * @return {Option}
       */
      hideHelp(hide = true) {
        this.hidden = !!hide;
        return this;
      }
      /**
       * @package
       */
      _concatValue(value, previous) {
        if (previous === this.defaultValue || !Array.isArray(previous)) {
          return [value];
        }
        return previous.concat(value);
      }
      /**
       * Only allow option value to be one of choices.
       *
       * @param {string[]} values
       * @return {Option}
       */
      choices(values) {
        this.argChoices = values.slice();
        this.parseArg = (arg, previous) => {
          if (!this.argChoices.includes(arg)) {
            throw new InvalidArgumentError2(
              `Allowed choices are ${this.argChoices.join(", ")}.`
            );
          }
          if (this.variadic) {
            return this._concatValue(arg, previous);
          }
          return arg;
        };
        return this;
      }
      /**
       * Return option name.
       *
       * @return {string}
       */
      name() {
        if (this.long) {
          return this.long.replace(/^--/, "");
        }
        return this.short.replace(/^-/, "");
      }
      /**
       * Return option name, in a camelcase format that can be used
       * as a object attribute key.
       *
       * @return {string}
       */
      attributeName() {
        return camelcase(this.name().replace(/^no-/, ""));
      }
      /**
       * Check if `arg` matches the short or long flag.
       *
       * @param {string} arg
       * @return {boolean}
       * @package
       */
      is(arg) {
        return this.short === arg || this.long === arg;
      }
      /**
       * Return whether a boolean option.
       *
       * Options are one of boolean, negated, required argument, or optional argument.
       *
       * @return {boolean}
       * @package
       */
      isBoolean() {
        return !this.required && !this.optional && !this.negate;
      }
    };
    var DualOptions = class {
      /**
       * @param {Option[]} options
       */
      constructor(options) {
        this.positiveOptions = /* @__PURE__ */ new Map();
        this.negativeOptions = /* @__PURE__ */ new Map();
        this.dualOptions = /* @__PURE__ */ new Set();
        options.forEach((option) => {
          if (option.negate) {
            this.negativeOptions.set(option.attributeName(), option);
          } else {
            this.positiveOptions.set(option.attributeName(), option);
          }
        });
        this.negativeOptions.forEach((value, key) => {
          if (this.positiveOptions.has(key)) {
            this.dualOptions.add(key);
          }
        });
      }
      /**
       * Did the value come from the option, and not from possible matching dual option?
       *
       * @param {*} value
       * @param {Option} option
       * @returns {boolean}
       */
      valueFromOption(value, option) {
        const optionKey = option.attributeName();
        if (!this.dualOptions.has(optionKey)) return true;
        const preset = this.negativeOptions.get(optionKey).presetArg;
        const negativeValue = preset !== void 0 ? preset : false;
        return option.negate === (negativeValue === value);
      }
    };
    function camelcase(str) {
      return str.split("-").reduce((str2, word) => {
        return str2 + word[0].toUpperCase() + word.slice(1);
      });
    }
    function splitOptionFlags(flags) {
      let shortFlag;
      let longFlag;
      const flagParts = flags.split(/[ |,]+/);
      if (flagParts.length > 1 && !/^[[<]/.test(flagParts[1]))
        shortFlag = flagParts.shift();
      longFlag = flagParts.shift();
      if (!shortFlag && /^-[^-]$/.test(longFlag)) {
        shortFlag = longFlag;
        longFlag = void 0;
      }
      return { shortFlag, longFlag };
    }
    exports.Option = Option2;
    exports.DualOptions = DualOptions;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/suggestSimilar.js
var require_suggestSimilar = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/suggestSimilar.js"(exports) {
    var maxDistance = 3;
    function editDistance(a, b) {
      if (Math.abs(a.length - b.length) > maxDistance)
        return Math.max(a.length, b.length);
      const d = [];
      for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
      }
      for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
      }
      for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
          let cost = 1;
          if (a[i - 1] === b[j - 1]) {
            cost = 0;
          } else {
            cost = 1;
          }
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            // deletion
            d[i][j - 1] + 1,
            // insertion
            d[i - 1][j - 1] + cost
            // substitution
          );
          if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
            d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
          }
        }
      }
      return d[a.length][b.length];
    }
    function suggestSimilar(word, candidates) {
      if (!candidates || candidates.length === 0) return "";
      candidates = Array.from(new Set(candidates));
      const searchingOptions = word.startsWith("--");
      if (searchingOptions) {
        word = word.slice(2);
        candidates = candidates.map((candidate) => candidate.slice(2));
      }
      let similar = [];
      let bestDistance = maxDistance;
      const minSimilarity = 0.4;
      candidates.forEach((candidate) => {
        if (candidate.length <= 1) return;
        const distance = editDistance(word, candidate);
        const length = Math.max(word.length, candidate.length);
        const similarity = (length - distance) / length;
        if (similarity > minSimilarity) {
          if (distance < bestDistance) {
            bestDistance = distance;
            similar = [candidate];
          } else if (distance === bestDistance) {
            similar.push(candidate);
          }
        }
      });
      similar.sort((a, b) => a.localeCompare(b));
      if (searchingOptions) {
        similar = similar.map((candidate) => `--${candidate}`);
      }
      if (similar.length > 1) {
        return `
(Did you mean one of ${similar.join(", ")}?)`;
      }
      if (similar.length === 1) {
        return `
(Did you mean ${similar[0]}?)`;
      }
      return "";
    }
    exports.suggestSimilar = suggestSimilar;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/command.js
var require_command = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/lib/command.js"(exports) {
    var EventEmitter = __require("node:events").EventEmitter;
    var childProcess = __require("node:child_process");
    var path2 = __require("node:path");
    var fs = __require("node:fs");
    var process2 = __require("node:process");
    var { Argument: Argument2, humanReadableArgName } = require_argument();
    var { CommanderError: CommanderError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2, DualOptions } = require_option();
    var { suggestSimilar } = require_suggestSimilar();
    var Command2 = class _Command extends EventEmitter {
      /**
       * Initialize a new `Command`.
       *
       * @param {string} [name]
       */
      constructor(name) {
        super();
        this.commands = [];
        this.options = [];
        this.parent = null;
        this._allowUnknownOption = false;
        this._allowExcessArguments = true;
        this.registeredArguments = [];
        this._args = this.registeredArguments;
        this.args = [];
        this.rawArgs = [];
        this.processedArgs = [];
        this._scriptPath = null;
        this._name = name || "";
        this._optionValues = {};
        this._optionValueSources = {};
        this._storeOptionsAsProperties = false;
        this._actionHandler = null;
        this._executableHandler = false;
        this._executableFile = null;
        this._executableDir = null;
        this._defaultCommandName = null;
        this._exitCallback = null;
        this._aliases = [];
        this._combineFlagAndOptionalValue = true;
        this._description = "";
        this._summary = "";
        this._argsDescription = void 0;
        this._enablePositionalOptions = false;
        this._passThroughOptions = false;
        this._lifeCycleHooks = {};
        this._showHelpAfterError = false;
        this._showSuggestionAfterError = true;
        this._outputConfiguration = {
          writeOut: (str) => process2.stdout.write(str),
          writeErr: (str) => process2.stderr.write(str),
          getOutHelpWidth: () => process2.stdout.isTTY ? process2.stdout.columns : void 0,
          getErrHelpWidth: () => process2.stderr.isTTY ? process2.stderr.columns : void 0,
          outputError: (str, write) => write(str)
        };
        this._hidden = false;
        this._helpOption = void 0;
        this._addImplicitHelpCommand = void 0;
        this._helpCommand = void 0;
        this._helpConfiguration = {};
      }
      /**
       * Copy settings that are useful to have in common across root command and subcommands.
       *
       * (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
       *
       * @param {Command} sourceCommand
       * @return {Command} `this` command for chaining
       */
      copyInheritedSettings(sourceCommand) {
        this._outputConfiguration = sourceCommand._outputConfiguration;
        this._helpOption = sourceCommand._helpOption;
        this._helpCommand = sourceCommand._helpCommand;
        this._helpConfiguration = sourceCommand._helpConfiguration;
        this._exitCallback = sourceCommand._exitCallback;
        this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
        this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
        this._allowExcessArguments = sourceCommand._allowExcessArguments;
        this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
        this._showHelpAfterError = sourceCommand._showHelpAfterError;
        this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
        return this;
      }
      /**
       * @returns {Command[]}
       * @private
       */
      _getCommandAndAncestors() {
        const result = [];
        for (let command = this; command; command = command.parent) {
          result.push(command);
        }
        return result;
      }
      /**
       * Define a command.
       *
       * There are two styles of command: pay attention to where to put the description.
       *
       * @example
       * // Command implemented using action handler (description is supplied separately to `.command`)
       * program
       *   .command('clone <source> [destination]')
       *   .description('clone a repository into a newly created directory')
       *   .action((source, destination) => {
       *     console.log('clone command called');
       *   });
       *
       * // Command implemented using separate executable file (description is second parameter to `.command`)
       * program
       *   .command('start <service>', 'start named service')
       *   .command('stop [service]', 'stop named service, or all if no name supplied');
       *
       * @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
       * @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
       * @param {object} [execOpts] - configuration options (for executable)
       * @return {Command} returns new command for action handler, or `this` for executable command
       */
      command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
        let desc = actionOptsOrExecDesc;
        let opts = execOpts;
        if (typeof desc === "object" && desc !== null) {
          opts = desc;
          desc = null;
        }
        opts = opts || {};
        const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
        const cmd = this.createCommand(name);
        if (desc) {
          cmd.description(desc);
          cmd._executableHandler = true;
        }
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        cmd._hidden = !!(opts.noHelp || opts.hidden);
        cmd._executableFile = opts.executableFile || null;
        if (args) cmd.arguments(args);
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd.copyInheritedSettings(this);
        if (desc) return this;
        return cmd;
      }
      /**
       * Factory routine to create a new unattached command.
       *
       * See .command() for creating an attached subcommand, which uses this routine to
       * create the command. You can override createCommand to customise subcommands.
       *
       * @param {string} [name]
       * @return {Command} new command
       */
      createCommand(name) {
        return new _Command(name);
      }
      /**
       * You can customise the help with a subclass of Help by overriding createHelp,
       * or by overriding Help properties using configureHelp().
       *
       * @return {Help}
       */
      createHelp() {
        return Object.assign(new Help2(), this.configureHelp());
      }
      /**
       * You can customise the help by overriding Help properties using configureHelp(),
       * or with a subclass of Help by overriding createHelp().
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureHelp(configuration) {
        if (configuration === void 0) return this._helpConfiguration;
        this._helpConfiguration = configuration;
        return this;
      }
      /**
       * The default output goes to stdout and stderr. You can customise this for special
       * applications. You can also customise the display of errors by overriding outputError.
       *
       * The configuration properties are all functions:
       *
       *     // functions to change where being written, stdout and stderr
       *     writeOut(str)
       *     writeErr(str)
       *     // matching functions to specify width for wrapping help
       *     getOutHelpWidth()
       *     getErrHelpWidth()
       *     // functions based on what is being written out
       *     outputError(str, write) // used for displaying errors, and not used for displaying help
       *
       * @param {object} [configuration] - configuration options
       * @return {(Command | object)} `this` command for chaining, or stored configuration
       */
      configureOutput(configuration) {
        if (configuration === void 0) return this._outputConfiguration;
        Object.assign(this._outputConfiguration, configuration);
        return this;
      }
      /**
       * Display the help or a custom message after an error occurs.
       *
       * @param {(boolean|string)} [displayHelp]
       * @return {Command} `this` command for chaining
       */
      showHelpAfterError(displayHelp = true) {
        if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
        this._showHelpAfterError = displayHelp;
        return this;
      }
      /**
       * Display suggestion of similar commands for unknown commands, or options for unknown options.
       *
       * @param {boolean} [displaySuggestion]
       * @return {Command} `this` command for chaining
       */
      showSuggestionAfterError(displaySuggestion = true) {
        this._showSuggestionAfterError = !!displaySuggestion;
        return this;
      }
      /**
       * Add a prepared subcommand.
       *
       * See .command() for creating an attached subcommand which inherits settings from its parent.
       *
       * @param {Command} cmd - new subcommand
       * @param {object} [opts] - configuration options
       * @return {Command} `this` command for chaining
       */
      addCommand(cmd, opts) {
        if (!cmd._name) {
          throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
        }
        opts = opts || {};
        if (opts.isDefault) this._defaultCommandName = cmd._name;
        if (opts.noHelp || opts.hidden) cmd._hidden = true;
        this._registerCommand(cmd);
        cmd.parent = this;
        cmd._checkForBrokenPassThrough();
        return this;
      }
      /**
       * Factory routine to create a new unattached argument.
       *
       * See .argument() for creating an attached argument, which uses this routine to
       * create the argument. You can override createArgument to return a custom argument.
       *
       * @param {string} name
       * @param {string} [description]
       * @return {Argument} new argument
       */
      createArgument(name, description) {
        return new Argument2(name, description);
      }
      /**
       * Define argument syntax for command.
       *
       * The default is that the argument is required, and you can explicitly
       * indicate this with <> around the name. Put [] around the name for an optional argument.
       *
       * @example
       * program.argument('<input-file>');
       * program.argument('[output-file]');
       *
       * @param {string} name
       * @param {string} [description]
       * @param {(Function|*)} [fn] - custom argument processing function
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      argument(name, description, fn, defaultValue) {
        const argument = this.createArgument(name, description);
        if (typeof fn === "function") {
          argument.default(defaultValue).argParser(fn);
        } else {
          argument.default(fn);
        }
        this.addArgument(argument);
        return this;
      }
      /**
       * Define argument syntax for command, adding multiple at once (without descriptions).
       *
       * See also .argument().
       *
       * @example
       * program.arguments('<cmd> [env]');
       *
       * @param {string} names
       * @return {Command} `this` command for chaining
       */
      arguments(names) {
        names.trim().split(/ +/).forEach((detail) => {
          this.argument(detail);
        });
        return this;
      }
      /**
       * Define argument syntax for command, adding a prepared argument.
       *
       * @param {Argument} argument
       * @return {Command} `this` command for chaining
       */
      addArgument(argument) {
        const previousArgument = this.registeredArguments.slice(-1)[0];
        if (previousArgument && previousArgument.variadic) {
          throw new Error(
            `only the last argument can be variadic '${previousArgument.name()}'`
          );
        }
        if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) {
          throw new Error(
            `a default value for a required argument is never used: '${argument.name()}'`
          );
        }
        this.registeredArguments.push(argument);
        return this;
      }
      /**
       * Customise or override default help command. By default a help command is automatically added if your command has subcommands.
       *
       * @example
       *    program.helpCommand('help [cmd]');
       *    program.helpCommand('help [cmd]', 'show help');
       *    program.helpCommand(false); // suppress default help command
       *    program.helpCommand(true); // add help command even if no subcommands
       *
       * @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
       * @param {string} [description] - custom description
       * @return {Command} `this` command for chaining
       */
      helpCommand(enableOrNameAndArgs, description) {
        if (typeof enableOrNameAndArgs === "boolean") {
          this._addImplicitHelpCommand = enableOrNameAndArgs;
          return this;
        }
        enableOrNameAndArgs = enableOrNameAndArgs ?? "help [command]";
        const [, helpName, helpArgs] = enableOrNameAndArgs.match(/([^ ]+) *(.*)/);
        const helpDescription = description ?? "display help for command";
        const helpCommand = this.createCommand(helpName);
        helpCommand.helpOption(false);
        if (helpArgs) helpCommand.arguments(helpArgs);
        if (helpDescription) helpCommand.description(helpDescription);
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Add prepared custom help command.
       *
       * @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
       * @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
       * @return {Command} `this` command for chaining
       */
      addHelpCommand(helpCommand, deprecatedDescription) {
        if (typeof helpCommand !== "object") {
          this.helpCommand(helpCommand, deprecatedDescription);
          return this;
        }
        this._addImplicitHelpCommand = true;
        this._helpCommand = helpCommand;
        return this;
      }
      /**
       * Lazy create help command.
       *
       * @return {(Command|null)}
       * @package
       */
      _getHelpCommand() {
        const hasImplicitHelpCommand = this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"));
        if (hasImplicitHelpCommand) {
          if (this._helpCommand === void 0) {
            this.helpCommand(void 0, void 0);
          }
          return this._helpCommand;
        }
        return null;
      }
      /**
       * Add hook for life cycle event.
       *
       * @param {string} event
       * @param {Function} listener
       * @return {Command} `this` command for chaining
       */
      hook(event, listener) {
        const allowedValues = ["preSubcommand", "preAction", "postAction"];
        if (!allowedValues.includes(event)) {
          throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        if (this._lifeCycleHooks[event]) {
          this._lifeCycleHooks[event].push(listener);
        } else {
          this._lifeCycleHooks[event] = [listener];
        }
        return this;
      }
      /**
       * Register callback to use as replacement for calling process.exit.
       *
       * @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
       * @return {Command} `this` command for chaining
       */
      exitOverride(fn) {
        if (fn) {
          this._exitCallback = fn;
        } else {
          this._exitCallback = (err) => {
            if (err.code !== "commander.executeSubCommandAsync") {
              throw err;
            } else {
            }
          };
        }
        return this;
      }
      /**
       * Call process.exit, and _exitCallback if defined.
       *
       * @param {number} exitCode exit code for using with process.exit
       * @param {string} code an id string representing the error
       * @param {string} message human-readable description of the error
       * @return never
       * @private
       */
      _exit(exitCode, code, message) {
        if (this._exitCallback) {
          this._exitCallback(new CommanderError2(exitCode, code, message));
        }
        process2.exit(exitCode);
      }
      /**
       * Register callback `fn` for the command.
       *
       * @example
       * program
       *   .command('serve')
       *   .description('start service')
       *   .action(function() {
       *      // do work here
       *   });
       *
       * @param {Function} fn
       * @return {Command} `this` command for chaining
       */
      action(fn) {
        const listener = (args) => {
          const expectedArgsCount = this.registeredArguments.length;
          const actionArgs = args.slice(0, expectedArgsCount);
          if (this._storeOptionsAsProperties) {
            actionArgs[expectedArgsCount] = this;
          } else {
            actionArgs[expectedArgsCount] = this.opts();
          }
          actionArgs.push(this);
          return fn.apply(this, actionArgs);
        };
        this._actionHandler = listener;
        return this;
      }
      /**
       * Factory routine to create a new unattached option.
       *
       * See .option() for creating an attached option, which uses this routine to
       * create the option. You can override createOption to return a custom option.
       *
       * @param {string} flags
       * @param {string} [description]
       * @return {Option} new option
       */
      createOption(flags, description) {
        return new Option2(flags, description);
      }
      /**
       * Wrap parseArgs to catch 'commander.invalidArgument'.
       *
       * @param {(Option | Argument)} target
       * @param {string} value
       * @param {*} previous
       * @param {string} invalidArgumentMessage
       * @private
       */
      _callParseArg(target, value, previous, invalidArgumentMessage) {
        try {
          return target.parseArg(value, previous);
        } catch (err) {
          if (err.code === "commander.invalidArgument") {
            const message = `${invalidArgumentMessage} ${err.message}`;
            this.error(message, { exitCode: err.exitCode, code: err.code });
          }
          throw err;
        }
      }
      /**
       * Check for option flag conflicts.
       * Register option if no conflicts found, or throw on conflict.
       *
       * @param {Option} option
       * @private
       */
      _registerOption(option) {
        const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
        if (matchingOption) {
          const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
          throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
        }
        this.options.push(option);
      }
      /**
       * Check for command name and alias conflicts with existing commands.
       * Register command if no conflicts found, or throw on conflict.
       *
       * @param {Command} command
       * @private
       */
      _registerCommand(command) {
        const knownBy = (cmd) => {
          return [cmd.name()].concat(cmd.aliases());
        };
        const alreadyUsed = knownBy(command).find(
          (name) => this._findCommand(name)
        );
        if (alreadyUsed) {
          const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
          const newCmd = knownBy(command).join("|");
          throw new Error(
            `cannot add command '${newCmd}' as already have command '${existingCmd}'`
          );
        }
        this.commands.push(command);
      }
      /**
       * Add an option.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addOption(option) {
        this._registerOption(option);
        const oname = option.name();
        const name = option.attributeName();
        if (option.negate) {
          const positiveLongFlag = option.long.replace(/^--no-/, "--");
          if (!this._findOption(positiveLongFlag)) {
            this.setOptionValueWithSource(
              name,
              option.defaultValue === void 0 ? true : option.defaultValue,
              "default"
            );
          }
        } else if (option.defaultValue !== void 0) {
          this.setOptionValueWithSource(name, option.defaultValue, "default");
        }
        const handleOptionValue = (val, invalidValueMessage, valueSource) => {
          if (val == null && option.presetArg !== void 0) {
            val = option.presetArg;
          }
          const oldValue = this.getOptionValue(name);
          if (val !== null && option.parseArg) {
            val = this._callParseArg(option, val, oldValue, invalidValueMessage);
          } else if (val !== null && option.variadic) {
            val = option._concatValue(val, oldValue);
          }
          if (val == null) {
            if (option.negate) {
              val = false;
            } else if (option.isBoolean() || option.optional) {
              val = true;
            } else {
              val = "";
            }
          }
          this.setOptionValueWithSource(name, val, valueSource);
        };
        this.on("option:" + oname, (val) => {
          const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
          handleOptionValue(val, invalidValueMessage, "cli");
        });
        if (option.envVar) {
          this.on("optionEnv:" + oname, (val) => {
            const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
            handleOptionValue(val, invalidValueMessage, "env");
          });
        }
        return this;
      }
      /**
       * Internal implementation shared by .option() and .requiredOption()
       *
       * @return {Command} `this` command for chaining
       * @private
       */
      _optionEx(config, flags, description, fn, defaultValue) {
        if (typeof flags === "object" && flags instanceof Option2) {
          throw new Error(
            "To add an Option object use addOption() instead of option() or requiredOption()"
          );
        }
        const option = this.createOption(flags, description);
        option.makeOptionMandatory(!!config.mandatory);
        if (typeof fn === "function") {
          option.default(defaultValue).argParser(fn);
        } else if (fn instanceof RegExp) {
          const regex = fn;
          fn = (val, def) => {
            const m = regex.exec(val);
            return m ? m[0] : def;
          };
          option.default(defaultValue).argParser(fn);
        } else {
          option.default(fn);
        }
        return this.addOption(option);
      }
      /**
       * Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
       * option-argument is indicated by `<>` and an optional option-argument by `[]`.
       *
       * See the README for more details, and see also addOption() and requiredOption().
       *
       * @example
       * program
       *     .option('-p, --pepper', 'add pepper')
       *     .option('-p, --pizza-type <TYPE>', 'type of pizza') // required option-argument
       *     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
       *     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      option(flags, description, parseArg, defaultValue) {
        return this._optionEx({}, flags, description, parseArg, defaultValue);
      }
      /**
       * Add a required option which must have a value after parsing. This usually means
       * the option must be specified on the command line. (Otherwise the same as .option().)
       *
       * The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
       *
       * @param {string} flags
       * @param {string} [description]
       * @param {(Function|*)} [parseArg] - custom option processing function or default value
       * @param {*} [defaultValue]
       * @return {Command} `this` command for chaining
       */
      requiredOption(flags, description, parseArg, defaultValue) {
        return this._optionEx(
          { mandatory: true },
          flags,
          description,
          parseArg,
          defaultValue
        );
      }
      /**
       * Alter parsing of short flags with optional values.
       *
       * @example
       * // for `.option('-f,--flag [value]'):
       * program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
       * program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
       *
       * @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
       * @return {Command} `this` command for chaining
       */
      combineFlagAndOptionalValue(combine = true) {
        this._combineFlagAndOptionalValue = !!combine;
        return this;
      }
      /**
       * Allow unknown options on the command line.
       *
       * @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
       * @return {Command} `this` command for chaining
       */
      allowUnknownOption(allowUnknown = true) {
        this._allowUnknownOption = !!allowUnknown;
        return this;
      }
      /**
       * Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
       *
       * @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
       * @return {Command} `this` command for chaining
       */
      allowExcessArguments(allowExcess = true) {
        this._allowExcessArguments = !!allowExcess;
        return this;
      }
      /**
       * Enable positional options. Positional means global options are specified before subcommands which lets
       * subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
       * The default behaviour is non-positional and global options may appear anywhere on the command line.
       *
       * @param {boolean} [positional]
       * @return {Command} `this` command for chaining
       */
      enablePositionalOptions(positional = true) {
        this._enablePositionalOptions = !!positional;
        return this;
      }
      /**
       * Pass through options that come after command-arguments rather than treat them as command-options,
       * so actual command-options come before command-arguments. Turning this on for a subcommand requires
       * positional options to have been enabled on the program (parent commands).
       * The default behaviour is non-positional and options may appear before or after command-arguments.
       *
       * @param {boolean} [passThrough] for unknown options.
       * @return {Command} `this` command for chaining
       */
      passThroughOptions(passThrough = true) {
        this._passThroughOptions = !!passThrough;
        this._checkForBrokenPassThrough();
        return this;
      }
      /**
       * @private
       */
      _checkForBrokenPassThrough() {
        if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) {
          throw new Error(
            `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`
          );
        }
      }
      /**
       * Whether to store option values as properties on command object,
       * or store separately (specify false). In both cases the option values can be accessed using .opts().
       *
       * @param {boolean} [storeAsProperties=true]
       * @return {Command} `this` command for chaining
       */
      storeOptionsAsProperties(storeAsProperties = true) {
        if (this.options.length) {
          throw new Error("call .storeOptionsAsProperties() before adding options");
        }
        if (Object.keys(this._optionValues).length) {
          throw new Error(
            "call .storeOptionsAsProperties() before setting option values"
          );
        }
        this._storeOptionsAsProperties = !!storeAsProperties;
        return this;
      }
      /**
       * Retrieve option value.
       *
       * @param {string} key
       * @return {object} value
       */
      getOptionValue(key) {
        if (this._storeOptionsAsProperties) {
          return this[key];
        }
        return this._optionValues[key];
      }
      /**
       * Store option value.
       *
       * @param {string} key
       * @param {object} value
       * @return {Command} `this` command for chaining
       */
      setOptionValue(key, value) {
        return this.setOptionValueWithSource(key, value, void 0);
      }
      /**
       * Store option value and where the value came from.
       *
       * @param {string} key
       * @param {object} value
       * @param {string} source - expected values are default/config/env/cli/implied
       * @return {Command} `this` command for chaining
       */
      setOptionValueWithSource(key, value, source) {
        if (this._storeOptionsAsProperties) {
          this[key] = value;
        } else {
          this._optionValues[key] = value;
        }
        this._optionValueSources[key] = source;
        return this;
      }
      /**
       * Get source of option value.
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSource(key) {
        return this._optionValueSources[key];
      }
      /**
       * Get source of option value. See also .optsWithGlobals().
       * Expected values are default | config | env | cli | implied
       *
       * @param {string} key
       * @return {string}
       */
      getOptionValueSourceWithGlobals(key) {
        let source;
        this._getCommandAndAncestors().forEach((cmd) => {
          if (cmd.getOptionValueSource(key) !== void 0) {
            source = cmd.getOptionValueSource(key);
          }
        });
        return source;
      }
      /**
       * Get user arguments from implied or explicit arguments.
       * Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
       *
       * @private
       */
      _prepareUserArgs(argv, parseOptions) {
        if (argv !== void 0 && !Array.isArray(argv)) {
          throw new Error("first parameter to parse must be array or undefined");
        }
        parseOptions = parseOptions || {};
        if (argv === void 0 && parseOptions.from === void 0) {
          if (process2.versions?.electron) {
            parseOptions.from = "electron";
          }
          const execArgv = process2.execArgv ?? [];
          if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) {
            parseOptions.from = "eval";
          }
        }
        if (argv === void 0) {
          argv = process2.argv;
        }
        this.rawArgs = argv.slice();
        let userArgs;
        switch (parseOptions.from) {
          case void 0:
          case "node":
            this._scriptPath = argv[1];
            userArgs = argv.slice(2);
            break;
          case "electron":
            if (process2.defaultApp) {
              this._scriptPath = argv[1];
              userArgs = argv.slice(2);
            } else {
              userArgs = argv.slice(1);
            }
            break;
          case "user":
            userArgs = argv.slice(0);
            break;
          case "eval":
            userArgs = argv.slice(1);
            break;
          default:
            throw new Error(
              `unexpected parse option { from: '${parseOptions.from}' }`
            );
        }
        if (!this._name && this._scriptPath)
          this.nameFromFilename(this._scriptPath);
        this._name = this._name || "program";
        return userArgs;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Use parseAsync instead of parse if any of your action handlers are async.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * program.parse(); // parse process.argv and auto-detect electron and special node flags
       * program.parse(process.argv); // assume argv[0] is app and argv[1] is script
       * program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv] - optional, defaults to process.argv
       * @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
       * @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
       * @return {Command} `this` command for chaining
       */
      parse(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Parse `argv`, setting options and invoking commands when defined.
       *
       * Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
       *
       * Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
       * - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
       * - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
       * - `'user'`: just user arguments
       *
       * @example
       * await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
       * await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
       * await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
       *
       * @param {string[]} [argv]
       * @param {object} [parseOptions]
       * @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
       * @return {Promise}
       */
      async parseAsync(argv, parseOptions) {
        const userArgs = this._prepareUserArgs(argv, parseOptions);
        await this._parseCommand([], userArgs);
        return this;
      }
      /**
       * Execute a sub-command executable.
       *
       * @private
       */
      _executeSubCommand(subcommand, args) {
        args = args.slice();
        let launchWithNode = false;
        const sourceExt = [".js", ".ts", ".tsx", ".mjs", ".cjs"];
        function findFile(baseDir, baseName) {
          const localBin = path2.resolve(baseDir, baseName);
          if (fs.existsSync(localBin)) return localBin;
          if (sourceExt.includes(path2.extname(baseName))) return void 0;
          const foundExt = sourceExt.find(
            (ext) => fs.existsSync(`${localBin}${ext}`)
          );
          if (foundExt) return `${localBin}${foundExt}`;
          return void 0;
        }
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
        let executableDir = this._executableDir || "";
        if (this._scriptPath) {
          let resolvedScriptPath;
          try {
            resolvedScriptPath = fs.realpathSync(this._scriptPath);
          } catch (err) {
            resolvedScriptPath = this._scriptPath;
          }
          executableDir = path2.resolve(
            path2.dirname(resolvedScriptPath),
            executableDir
          );
        }
        if (executableDir) {
          let localFile = findFile(executableDir, executableFile);
          if (!localFile && !subcommand._executableFile && this._scriptPath) {
            const legacyName = path2.basename(
              this._scriptPath,
              path2.extname(this._scriptPath)
            );
            if (legacyName !== this._name) {
              localFile = findFile(
                executableDir,
                `${legacyName}-${subcommand._name}`
              );
            }
          }
          executableFile = localFile || executableFile;
        }
        launchWithNode = sourceExt.includes(path2.extname(executableFile));
        let proc;
        if (process2.platform !== "win32") {
          if (launchWithNode) {
            args.unshift(executableFile);
            args = incrementNodeInspectorPort(process2.execArgv).concat(args);
            proc = childProcess.spawn(process2.argv[0], args, { stdio: "inherit" });
          } else {
            proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
          }
        } else {
          args.unshift(executableFile);
          args = incrementNodeInspectorPort(process2.execArgv).concat(args);
          proc = childProcess.spawn(process2.execPath, args, { stdio: "inherit" });
        }
        if (!proc.killed) {
          const signals = ["SIGUSR1", "SIGUSR2", "SIGTERM", "SIGINT", "SIGHUP"];
          signals.forEach((signal) => {
            process2.on(signal, () => {
              if (proc.killed === false && proc.exitCode === null) {
                proc.kill(signal);
              }
            });
          });
        }
        const exitCallback = this._exitCallback;
        proc.on("close", (code) => {
          code = code ?? 1;
          if (!exitCallback) {
            process2.exit(code);
          } else {
            exitCallback(
              new CommanderError2(
                code,
                "commander.executeSubCommandAsync",
                "(close)"
              )
            );
          }
        });
        proc.on("error", (err) => {
          if (err.code === "ENOENT") {
            const executableDirMessage = executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory";
            const executableMissing = `'${executableFile}' does not exist
 - if '${subcommand._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDirMessage}`;
            throw new Error(executableMissing);
          } else if (err.code === "EACCES") {
            throw new Error(`'${executableFile}' not executable`);
          }
          if (!exitCallback) {
            process2.exit(1);
          } else {
            const wrappedError = new CommanderError2(
              1,
              "commander.executeSubCommandAsync",
              "(error)"
            );
            wrappedError.nestedError = err;
            exitCallback(wrappedError);
          }
        });
        this.runningCommand = proc;
      }
      /**
       * @private
       */
      _dispatchSubcommand(commandName, operands, unknown) {
        const subCommand = this._findCommand(commandName);
        if (!subCommand) this.help({ error: true });
        let promiseChain;
        promiseChain = this._chainOrCallSubCommandHook(
          promiseChain,
          subCommand,
          "preSubcommand"
        );
        promiseChain = this._chainOrCall(promiseChain, () => {
          if (subCommand._executableHandler) {
            this._executeSubCommand(subCommand, operands.concat(unknown));
          } else {
            return subCommand._parseCommand(operands, unknown);
          }
        });
        return promiseChain;
      }
      /**
       * Invoke help directly if possible, or dispatch if necessary.
       * e.g. help foo
       *
       * @private
       */
      _dispatchHelpCommand(subcommandName) {
        if (!subcommandName) {
          this.help();
        }
        const subCommand = this._findCommand(subcommandName);
        if (subCommand && !subCommand._executableHandler) {
          subCommand.help();
        }
        return this._dispatchSubcommand(
          subcommandName,
          [],
          [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]
        );
      }
      /**
       * Check this.args against expected this.registeredArguments.
       *
       * @private
       */
      _checkNumberOfArguments() {
        this.registeredArguments.forEach((arg, i) => {
          if (arg.required && this.args[i] == null) {
            this.missingArgument(arg.name());
          }
        });
        if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) {
          return;
        }
        if (this.args.length > this.registeredArguments.length) {
          this._excessArguments(this.args);
        }
      }
      /**
       * Process this.args using this.registeredArguments and save as this.processedArgs!
       *
       * @private
       */
      _processArguments() {
        const myParseArg = (argument, value, previous) => {
          let parsedValue = value;
          if (value !== null && argument.parseArg) {
            const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
            parsedValue = this._callParseArg(
              argument,
              value,
              previous,
              invalidValueMessage
            );
          }
          return parsedValue;
        };
        this._checkNumberOfArguments();
        const processedArgs = [];
        this.registeredArguments.forEach((declaredArg, index) => {
          let value = declaredArg.defaultValue;
          if (declaredArg.variadic) {
            if (index < this.args.length) {
              value = this.args.slice(index);
              if (declaredArg.parseArg) {
                value = value.reduce((processed, v) => {
                  return myParseArg(declaredArg, v, processed);
                }, declaredArg.defaultValue);
              }
            } else if (value === void 0) {
              value = [];
            }
          } else if (index < this.args.length) {
            value = this.args[index];
            if (declaredArg.parseArg) {
              value = myParseArg(declaredArg, value, declaredArg.defaultValue);
            }
          }
          processedArgs[index] = value;
        });
        this.processedArgs = processedArgs;
      }
      /**
       * Once we have a promise we chain, but call synchronously until then.
       *
       * @param {(Promise|undefined)} promise
       * @param {Function} fn
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCall(promise, fn) {
        if (promise && promise.then && typeof promise.then === "function") {
          return promise.then(() => fn());
        }
        return fn();
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallHooks(promise, event) {
        let result = promise;
        const hooks = [];
        this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
          hookedCommand._lifeCycleHooks[event].forEach((callback) => {
            hooks.push({ hookedCommand, callback });
          });
        });
        if (event === "postAction") {
          hooks.reverse();
        }
        hooks.forEach((hookDetail) => {
          result = this._chainOrCall(result, () => {
            return hookDetail.callback(hookDetail.hookedCommand, this);
          });
        });
        return result;
      }
      /**
       *
       * @param {(Promise|undefined)} promise
       * @param {Command} subCommand
       * @param {string} event
       * @return {(Promise|undefined)}
       * @private
       */
      _chainOrCallSubCommandHook(promise, subCommand, event) {
        let result = promise;
        if (this._lifeCycleHooks[event] !== void 0) {
          this._lifeCycleHooks[event].forEach((hook) => {
            result = this._chainOrCall(result, () => {
              return hook(this, subCommand);
            });
          });
        }
        return result;
      }
      /**
       * Process arguments in context of this command.
       * Returns action result, in case it is a promise.
       *
       * @private
       */
      _parseCommand(operands, unknown) {
        const parsed = this.parseOptions(unknown);
        this._parseOptionsEnv();
        this._parseOptionsImplied();
        operands = operands.concat(parsed.operands);
        unknown = parsed.unknown;
        this.args = operands.concat(unknown);
        if (operands && this._findCommand(operands[0])) {
          return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
        }
        if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) {
          return this._dispatchHelpCommand(operands[1]);
        }
        if (this._defaultCommandName) {
          this._outputHelpIfRequested(unknown);
          return this._dispatchSubcommand(
            this._defaultCommandName,
            operands,
            unknown
          );
        }
        if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) {
          this.help({ error: true });
        }
        this._outputHelpIfRequested(parsed.unknown);
        this._checkForMissingMandatoryOptions();
        this._checkForConflictingOptions();
        const checkForUnknownOptions = () => {
          if (parsed.unknown.length > 0) {
            this.unknownOption(parsed.unknown[0]);
          }
        };
        const commandEvent = `command:${this.name()}`;
        if (this._actionHandler) {
          checkForUnknownOptions();
          this._processArguments();
          let promiseChain;
          promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
          promiseChain = this._chainOrCall(
            promiseChain,
            () => this._actionHandler(this.processedArgs)
          );
          if (this.parent) {
            promiseChain = this._chainOrCall(promiseChain, () => {
              this.parent.emit(commandEvent, operands, unknown);
            });
          }
          promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
          return promiseChain;
        }
        if (this.parent && this.parent.listenerCount(commandEvent)) {
          checkForUnknownOptions();
          this._processArguments();
          this.parent.emit(commandEvent, operands, unknown);
        } else if (operands.length) {
          if (this._findCommand("*")) {
            return this._dispatchSubcommand("*", operands, unknown);
          }
          if (this.listenerCount("command:*")) {
            this.emit("command:*", operands, unknown);
          } else if (this.commands.length) {
            this.unknownCommand();
          } else {
            checkForUnknownOptions();
            this._processArguments();
          }
        } else if (this.commands.length) {
          checkForUnknownOptions();
          this.help({ error: true });
        } else {
          checkForUnknownOptions();
          this._processArguments();
        }
      }
      /**
       * Find matching command.
       *
       * @private
       * @return {Command | undefined}
       */
      _findCommand(name) {
        if (!name) return void 0;
        return this.commands.find(
          (cmd) => cmd._name === name || cmd._aliases.includes(name)
        );
      }
      /**
       * Return an option matching `arg` if any.
       *
       * @param {string} arg
       * @return {Option}
       * @package
       */
      _findOption(arg) {
        return this.options.find((option) => option.is(arg));
      }
      /**
       * Display an error message if a mandatory option does not have a value.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForMissingMandatoryOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd.options.forEach((anOption) => {
            if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) {
              cmd.missingMandatoryOptionValue(anOption);
            }
          });
        });
      }
      /**
       * Display an error message if conflicting options are used together in this.
       *
       * @private
       */
      _checkForConflictingLocalOptions() {
        const definedNonDefaultOptions = this.options.filter((option) => {
          const optionKey = option.attributeName();
          if (this.getOptionValue(optionKey) === void 0) {
            return false;
          }
          return this.getOptionValueSource(optionKey) !== "default";
        });
        const optionsWithConflicting = definedNonDefaultOptions.filter(
          (option) => option.conflictsWith.length > 0
        );
        optionsWithConflicting.forEach((option) => {
          const conflictingAndDefined = definedNonDefaultOptions.find(
            (defined) => option.conflictsWith.includes(defined.attributeName())
          );
          if (conflictingAndDefined) {
            this._conflictingOption(option, conflictingAndDefined);
          }
        });
      }
      /**
       * Display an error message if conflicting options are used together.
       * Called after checking for help flags in leaf subcommand.
       *
       * @private
       */
      _checkForConflictingOptions() {
        this._getCommandAndAncestors().forEach((cmd) => {
          cmd._checkForConflictingLocalOptions();
        });
      }
      /**
       * Parse options from `argv` removing known options,
       * and return argv split into operands and unknown arguments.
       *
       * Examples:
       *
       *     argv => operands, unknown
       *     --known kkk op => [op], []
       *     op --known kkk => [op], []
       *     sub --unknown uuu op => [sub], [--unknown uuu op]
       *     sub -- --unknown uuu op => [sub --unknown uuu op], []
       *
       * @param {string[]} argv
       * @return {{operands: string[], unknown: string[]}}
       */
      parseOptions(argv) {
        const operands = [];
        const unknown = [];
        let dest = operands;
        const args = argv.slice();
        function maybeOption(arg) {
          return arg.length > 1 && arg[0] === "-";
        }
        let activeVariadicOption = null;
        while (args.length) {
          const arg = args.shift();
          if (arg === "--") {
            if (dest === unknown) dest.push(arg);
            dest.push(...args);
            break;
          }
          if (activeVariadicOption && !maybeOption(arg)) {
            this.emit(`option:${activeVariadicOption.name()}`, arg);
            continue;
          }
          activeVariadicOption = null;
          if (maybeOption(arg)) {
            const option = this._findOption(arg);
            if (option) {
              if (option.required) {
                const value = args.shift();
                if (value === void 0) this.optionMissingArgument(option);
                this.emit(`option:${option.name()}`, value);
              } else if (option.optional) {
                let value = null;
                if (args.length > 0 && !maybeOption(args[0])) {
                  value = args.shift();
                }
                this.emit(`option:${option.name()}`, value);
              } else {
                this.emit(`option:${option.name()}`);
              }
              activeVariadicOption = option.variadic ? option : null;
              continue;
            }
          }
          if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
            const option = this._findOption(`-${arg[1]}`);
            if (option) {
              if (option.required || option.optional && this._combineFlagAndOptionalValue) {
                this.emit(`option:${option.name()}`, arg.slice(2));
              } else {
                this.emit(`option:${option.name()}`);
                args.unshift(`-${arg.slice(2)}`);
              }
              continue;
            }
          }
          if (/^--[^=]+=/.test(arg)) {
            const index = arg.indexOf("=");
            const option = this._findOption(arg.slice(0, index));
            if (option && (option.required || option.optional)) {
              this.emit(`option:${option.name()}`, arg.slice(index + 1));
              continue;
            }
          }
          if (maybeOption(arg)) {
            dest = unknown;
          }
          if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
            if (this._findCommand(arg)) {
              operands.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            } else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
              operands.push(arg);
              if (args.length > 0) operands.push(...args);
              break;
            } else if (this._defaultCommandName) {
              unknown.push(arg);
              if (args.length > 0) unknown.push(...args);
              break;
            }
          }
          if (this._passThroughOptions) {
            dest.push(arg);
            if (args.length > 0) dest.push(...args);
            break;
          }
          dest.push(arg);
        }
        return { operands, unknown };
      }
      /**
       * Return an object containing local option values as key-value pairs.
       *
       * @return {object}
       */
      opts() {
        if (this._storeOptionsAsProperties) {
          const result = {};
          const len = this.options.length;
          for (let i = 0; i < len; i++) {
            const key = this.options[i].attributeName();
            result[key] = key === this._versionOptionName ? this._version : this[key];
          }
          return result;
        }
        return this._optionValues;
      }
      /**
       * Return an object containing merged local and global option values as key-value pairs.
       *
       * @return {object}
       */
      optsWithGlobals() {
        return this._getCommandAndAncestors().reduce(
          (combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()),
          {}
        );
      }
      /**
       * Display error message and exit (or call exitOverride).
       *
       * @param {string} message
       * @param {object} [errorOptions]
       * @param {string} [errorOptions.code] - an id string representing the error
       * @param {number} [errorOptions.exitCode] - used with process.exit
       */
      error(message, errorOptions) {
        this._outputConfiguration.outputError(
          `${message}
`,
          this._outputConfiguration.writeErr
        );
        if (typeof this._showHelpAfterError === "string") {
          this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`);
        } else if (this._showHelpAfterError) {
          this._outputConfiguration.writeErr("\n");
          this.outputHelp({ error: true });
        }
        const config = errorOptions || {};
        const exitCode = config.exitCode || 1;
        const code = config.code || "commander.error";
        this._exit(exitCode, code, message);
      }
      /**
       * Apply any option related environment variables, if option does
       * not have a value from cli or client code.
       *
       * @private
       */
      _parseOptionsEnv() {
        this.options.forEach((option) => {
          if (option.envVar && option.envVar in process2.env) {
            const optionKey = option.attributeName();
            if (this.getOptionValue(optionKey) === void 0 || ["default", "config", "env"].includes(
              this.getOptionValueSource(optionKey)
            )) {
              if (option.required || option.optional) {
                this.emit(`optionEnv:${option.name()}`, process2.env[option.envVar]);
              } else {
                this.emit(`optionEnv:${option.name()}`);
              }
            }
          }
        });
      }
      /**
       * Apply any implied option values, if option is undefined or default value.
       *
       * @private
       */
      _parseOptionsImplied() {
        const dualHelper = new DualOptions(this.options);
        const hasCustomOptionValue = (optionKey) => {
          return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
        };
        this.options.filter(
          (option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(
            this.getOptionValue(option.attributeName()),
            option
          )
        ).forEach((option) => {
          Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
            this.setOptionValueWithSource(
              impliedKey,
              option.implied[impliedKey],
              "implied"
            );
          });
        });
      }
      /**
       * Argument `name` is missing.
       *
       * @param {string} name
       * @private
       */
      missingArgument(name) {
        const message = `error: missing required argument '${name}'`;
        this.error(message, { code: "commander.missingArgument" });
      }
      /**
       * `Option` is missing an argument.
       *
       * @param {Option} option
       * @private
       */
      optionMissingArgument(option) {
        const message = `error: option '${option.flags}' argument missing`;
        this.error(message, { code: "commander.optionMissingArgument" });
      }
      /**
       * `Option` does not have a value, and is a mandatory option.
       *
       * @param {Option} option
       * @private
       */
      missingMandatoryOptionValue(option) {
        const message = `error: required option '${option.flags}' not specified`;
        this.error(message, { code: "commander.missingMandatoryOptionValue" });
      }
      /**
       * `Option` conflicts with another option.
       *
       * @param {Option} option
       * @param {Option} conflictingOption
       * @private
       */
      _conflictingOption(option, conflictingOption) {
        const findBestOptionFromValue = (option2) => {
          const optionKey = option2.attributeName();
          const optionValue = this.getOptionValue(optionKey);
          const negativeOption = this.options.find(
            (target) => target.negate && optionKey === target.attributeName()
          );
          const positiveOption = this.options.find(
            (target) => !target.negate && optionKey === target.attributeName()
          );
          if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) {
            return negativeOption;
          }
          return positiveOption || option2;
        };
        const getErrorMessage = (option2) => {
          const bestOption = findBestOptionFromValue(option2);
          const optionKey = bestOption.attributeName();
          const source = this.getOptionValueSource(optionKey);
          if (source === "env") {
            return `environment variable '${bestOption.envVar}'`;
          }
          return `option '${bestOption.flags}'`;
        };
        const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
        this.error(message, { code: "commander.conflictingOption" });
      }
      /**
       * Unknown option `flag`.
       *
       * @param {string} flag
       * @private
       */
      unknownOption(flag) {
        if (this._allowUnknownOption) return;
        let suggestion = "";
        if (flag.startsWith("--") && this._showSuggestionAfterError) {
          let candidateFlags = [];
          let command = this;
          do {
            const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
            candidateFlags = candidateFlags.concat(moreFlags);
            command = command.parent;
          } while (command && !command._enablePositionalOptions);
          suggestion = suggestSimilar(flag, candidateFlags);
        }
        const message = `error: unknown option '${flag}'${suggestion}`;
        this.error(message, { code: "commander.unknownOption" });
      }
      /**
       * Excess arguments, more than expected.
       *
       * @param {string[]} receivedArgs
       * @private
       */
      _excessArguments(receivedArgs) {
        if (this._allowExcessArguments) return;
        const expected = this.registeredArguments.length;
        const s = expected === 1 ? "" : "s";
        const forSubcommand = this.parent ? ` for '${this.name()}'` : "";
        const message = `error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}.`;
        this.error(message, { code: "commander.excessArguments" });
      }
      /**
       * Unknown command.
       *
       * @private
       */
      unknownCommand() {
        const unknownName = this.args[0];
        let suggestion = "";
        if (this._showSuggestionAfterError) {
          const candidateNames = [];
          this.createHelp().visibleCommands(this).forEach((command) => {
            candidateNames.push(command.name());
            if (command.alias()) candidateNames.push(command.alias());
          });
          suggestion = suggestSimilar(unknownName, candidateNames);
        }
        const message = `error: unknown command '${unknownName}'${suggestion}`;
        this.error(message, { code: "commander.unknownCommand" });
      }
      /**
       * Get or set the program version.
       *
       * This method auto-registers the "-V, --version" option which will print the version number.
       *
       * You can optionally supply the flags and description to override the defaults.
       *
       * @param {string} [str]
       * @param {string} [flags]
       * @param {string} [description]
       * @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
       */
      version(str, flags, description) {
        if (str === void 0) return this._version;
        this._version = str;
        flags = flags || "-V, --version";
        description = description || "output the version number";
        const versionOption = this.createOption(flags, description);
        this._versionOptionName = versionOption.attributeName();
        this._registerOption(versionOption);
        this.on("option:" + versionOption.name(), () => {
          this._outputConfiguration.writeOut(`${str}
`);
          this._exit(0, "commander.version", str);
        });
        return this;
      }
      /**
       * Set the description.
       *
       * @param {string} [str]
       * @param {object} [argsDescription]
       * @return {(string|Command)}
       */
      description(str, argsDescription) {
        if (str === void 0 && argsDescription === void 0)
          return this._description;
        this._description = str;
        if (argsDescription) {
          this._argsDescription = argsDescription;
        }
        return this;
      }
      /**
       * Set the summary. Used when listed as subcommand of parent.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      summary(str) {
        if (str === void 0) return this._summary;
        this._summary = str;
        return this;
      }
      /**
       * Set an alias for the command.
       *
       * You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
       *
       * @param {string} [alias]
       * @return {(string|Command)}
       */
      alias(alias) {
        if (alias === void 0) return this._aliases[0];
        let command = this;
        if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) {
          command = this.commands[this.commands.length - 1];
        }
        if (alias === command._name)
          throw new Error("Command alias can't be the same as its name");
        const matchingCommand = this.parent?._findCommand(alias);
        if (matchingCommand) {
          const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
          throw new Error(
            `cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`
          );
        }
        command._aliases.push(alias);
        return this;
      }
      /**
       * Set aliases for the command.
       *
       * Only the first alias is shown in the auto-generated help.
       *
       * @param {string[]} [aliases]
       * @return {(string[]|Command)}
       */
      aliases(aliases) {
        if (aliases === void 0) return this._aliases;
        aliases.forEach((alias) => this.alias(alias));
        return this;
      }
      /**
       * Set / get the command usage `str`.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      usage(str) {
        if (str === void 0) {
          if (this._usage) return this._usage;
          const args = this.registeredArguments.map((arg) => {
            return humanReadableArgName(arg);
          });
          return [].concat(
            this.options.length || this._helpOption !== null ? "[options]" : [],
            this.commands.length ? "[command]" : [],
            this.registeredArguments.length ? args : []
          ).join(" ");
        }
        this._usage = str;
        return this;
      }
      /**
       * Get or set the name of the command.
       *
       * @param {string} [str]
       * @return {(string|Command)}
       */
      name(str) {
        if (str === void 0) return this._name;
        this._name = str;
        return this;
      }
      /**
       * Set the name of the command from script filename, such as process.argv[1],
       * or require.main.filename, or __filename.
       *
       * (Used internally and public although not documented in README.)
       *
       * @example
       * program.nameFromFilename(require.main.filename);
       *
       * @param {string} filename
       * @return {Command}
       */
      nameFromFilename(filename) {
        this._name = path2.basename(filename, path2.extname(filename));
        return this;
      }
      /**
       * Get or set the directory for searching for executable subcommands of this command.
       *
       * @example
       * program.executableDir(__dirname);
       * // or
       * program.executableDir('subcommands');
       *
       * @param {string} [path]
       * @return {(string|null|Command)}
       */
      executableDir(path3) {
        if (path3 === void 0) return this._executableDir;
        this._executableDir = path3;
        return this;
      }
      /**
       * Return program help documentation.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
       * @return {string}
       */
      helpInformation(contextOptions) {
        const helper = this.createHelp();
        if (helper.helpWidth === void 0) {
          helper.helpWidth = contextOptions && contextOptions.error ? this._outputConfiguration.getErrHelpWidth() : this._outputConfiguration.getOutHelpWidth();
        }
        return helper.formatHelp(this, helper);
      }
      /**
       * @private
       */
      _getHelpContext(contextOptions) {
        contextOptions = contextOptions || {};
        const context = { error: !!contextOptions.error };
        let write;
        if (context.error) {
          write = (arg) => this._outputConfiguration.writeErr(arg);
        } else {
          write = (arg) => this._outputConfiguration.writeOut(arg);
        }
        context.write = contextOptions.write || write;
        context.command = this;
        return context;
      }
      /**
       * Output help information for this command.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      outputHelp(contextOptions) {
        let deprecatedCallback;
        if (typeof contextOptions === "function") {
          deprecatedCallback = contextOptions;
          contextOptions = void 0;
        }
        const context = this._getHelpContext(contextOptions);
        this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", context));
        this.emit("beforeHelp", context);
        let helpInformation = this.helpInformation(context);
        if (deprecatedCallback) {
          helpInformation = deprecatedCallback(helpInformation);
          if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) {
            throw new Error("outputHelp callback must return a string or a Buffer");
          }
        }
        context.write(helpInformation);
        if (this._getHelpOption()?.long) {
          this.emit(this._getHelpOption().long);
        }
        this.emit("afterHelp", context);
        this._getCommandAndAncestors().forEach(
          (command) => command.emit("afterAllHelp", context)
        );
      }
      /**
       * You can pass in flags and a description to customise the built-in help option.
       * Pass in false to disable the built-in help option.
       *
       * @example
       * program.helpOption('-?, --help' 'show help'); // customise
       * program.helpOption(false); // disable
       *
       * @param {(string | boolean)} flags
       * @param {string} [description]
       * @return {Command} `this` command for chaining
       */
      helpOption(flags, description) {
        if (typeof flags === "boolean") {
          if (flags) {
            this._helpOption = this._helpOption ?? void 0;
          } else {
            this._helpOption = null;
          }
          return this;
        }
        flags = flags ?? "-h, --help";
        description = description ?? "display help for command";
        this._helpOption = this.createOption(flags, description);
        return this;
      }
      /**
       * Lazy create help option.
       * Returns null if has been disabled with .helpOption(false).
       *
       * @returns {(Option | null)} the help option
       * @package
       */
      _getHelpOption() {
        if (this._helpOption === void 0) {
          this.helpOption(void 0, void 0);
        }
        return this._helpOption;
      }
      /**
       * Supply your own option to use for the built-in help option.
       * This is an alternative to using helpOption() to customise the flags and description etc.
       *
       * @param {Option} option
       * @return {Command} `this` command for chaining
       */
      addHelpOption(option) {
        this._helpOption = option;
        return this;
      }
      /**
       * Output help information and exit.
       *
       * Outputs built-in help, and custom text added using `.addHelpText()`.
       *
       * @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
       */
      help(contextOptions) {
        this.outputHelp(contextOptions);
        let exitCode = process2.exitCode || 0;
        if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) {
          exitCode = 1;
        }
        this._exit(exitCode, "commander.help", "(outputHelp)");
      }
      /**
       * Add additional text to be displayed with the built-in help.
       *
       * Position is 'before' or 'after' to affect just this command,
       * and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
       *
       * @param {string} position - before or after built-in help
       * @param {(string | Function)} text - string to add, or a function returning a string
       * @return {Command} `this` command for chaining
       */
      addHelpText(position, text) {
        const allowedValues = ["beforeAll", "before", "after", "afterAll"];
        if (!allowedValues.includes(position)) {
          throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
        }
        const helpEvent = `${position}Help`;
        this.on(helpEvent, (context) => {
          let helpStr;
          if (typeof text === "function") {
            helpStr = text({ error: context.error, command: context.command });
          } else {
            helpStr = text;
          }
          if (helpStr) {
            context.write(`${helpStr}
`);
          }
        });
        return this;
      }
      /**
       * Output help information if help flags specified
       *
       * @param {Array} args - array of options to search for help flags
       * @private
       */
      _outputHelpIfRequested(args) {
        const helpOption = this._getHelpOption();
        const helpRequested = helpOption && args.find((arg) => helpOption.is(arg));
        if (helpRequested) {
          this.outputHelp();
          this._exit(0, "commander.helpDisplayed", "(outputHelp)");
        }
      }
    };
    function incrementNodeInspectorPort(args) {
      return args.map((arg) => {
        if (!arg.startsWith("--inspect")) {
          return arg;
        }
        let debugOption;
        let debugHost = "127.0.0.1";
        let debugPort = "9229";
        let match;
        if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) {
          debugOption = match[1];
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
          debugOption = match[1];
          if (/^\d+$/.test(match[3])) {
            debugPort = match[3];
          } else {
            debugHost = match[3];
          }
        } else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
          debugOption = match[1];
          debugHost = match[3];
          debugPort = match[4];
        }
        if (debugOption && debugPort !== "0") {
          return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
        }
        return arg;
      });
    }
    exports.Command = Command2;
  }
});

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/index.js
var require_commander = __commonJS({
  "node_modules/.pnpm/commander@12.1.0/node_modules/commander/index.js"(exports) {
    var { Argument: Argument2 } = require_argument();
    var { Command: Command2 } = require_command();
    var { CommanderError: CommanderError2, InvalidArgumentError: InvalidArgumentError2 } = require_error();
    var { Help: Help2 } = require_help();
    var { Option: Option2 } = require_option();
    exports.program = new Command2();
    exports.createCommand = (name) => new Command2(name);
    exports.createOption = (flags, description) => new Option2(flags, description);
    exports.createArgument = (name, description) => new Argument2(name, description);
    exports.Command = Command2;
    exports.Option = Option2;
    exports.Argument = Argument2;
    exports.Help = Help2;
    exports.CommanderError = CommanderError2;
    exports.InvalidArgumentError = InvalidArgumentError2;
    exports.InvalidOptionArgumentError = InvalidArgumentError2;
  }
});

// node_modules/.pnpm/@alran+oauth-lease-protocol@0.1.0-beta.0/node_modules/@alran/oauth-lease-protocol/dist/contracts.js
var AUTH_LEASE_PROTOCOL_VERSION = 1;
var AUTH_LEASE_AUDIENCE = "agent-backend";
var AUTH_LEASE_SCOPES = ["agent.default"];
var AUTH_LEASE_MAX_FRAME_BYTES = 64 * 1024;
var AUTH_LEASE_MAX_MIN_VALIDITY_MS = 5 * 60 * 1e3;
var MAX_REQUEST_ID_LENGTH = 128;
var MAX_ACCESS_TOKEN_LENGTH = 32 * 1024;
var REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
var ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: "Desktop authentication is required.",
  BROKER_UNAVAILABLE: "Desktop authentication integration is unavailable.",
  CAPABILITY_REJECTED: "Desktop authentication capability was rejected.",
  PROTOCOL_MISMATCH: "Desktop authentication protocol is incompatible.",
  INVALID_REQUEST: "Desktop authentication request is invalid.",
  INTERNAL_ERROR: "Desktop authentication request failed."
});
var AuthLeaseProtocolError = class extends Error {
  code;
  constructor(code) {
    super(ERROR_MESSAGES[code]);
    this.name = "AuthLeaseProtocolError";
    this.code = code;
  }
};
function parseAuthLeaseResponse(value) {
  const record = requireRecord(value);
  if (record.version !== AUTH_LEASE_PROTOCOL_VERSION) {
    throw new AuthLeaseProtocolError("PROTOCOL_MISMATCH");
  }
  const requestId = requireRequestId(record.requestId);
  if (record.ok === true) {
    requireExactKeys(record, ["version", "requestId", "ok", "result"]);
    return {
      version: 1,
      requestId,
      ok: true,
      result: parseSuccessResult(record.result)
    };
  }
  if (record.ok === false) {
    requireExactKeys(record, ["version", "requestId", "ok", "error"]);
    const error = requireRecord(record.error);
    requireExactKeys(error, ["code", "message"]);
    const code = requireErrorCode(error.code);
    if (error.message !== ERROR_MESSAGES[code]) {
      throw new AuthLeaseProtocolError("INVALID_REQUEST");
    }
    return { version: 1, requestId, ok: false, error: { code, message: ERROR_MESSAGES[code] } };
  }
  throw new AuthLeaseProtocolError("INVALID_REQUEST");
}
function parseSuccessResult(value) {
  const result = requireRecord(value);
  if (result.method === "status")
    return parseStatusResult(result);
  if (result.method === "lease")
    return parseLeaseResult(result);
  if (result.method === "unauthorized")
    return parseUnauthorizedResult(result);
  throw new AuthLeaseProtocolError("INVALID_REQUEST");
}
function parseStatusResult(result) {
  const allowedKeys = ["method", "status", "generation"];
  if (result.expiresAtMs !== void 0)
    allowedKeys.push("expiresAtMs");
  requireExactKeys(result, allowedKeys);
  const statuses = [
    "anonymous",
    "authorizing",
    "authenticated",
    "refreshing",
    "scope_upgrade_required",
    "logging_out",
    "logout_pending",
    "expired",
    "error"
  ];
  if (!statuses.includes(result.status)) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  const status = result.status;
  const generation = requireBoundedInteger(result.generation, 0, Number.MAX_SAFE_INTEGER);
  if (result.expiresAtMs === void 0)
    return { method: "status", status, generation };
  return {
    method: "status",
    status,
    generation,
    expiresAtMs: requireBoundedInteger(result.expiresAtMs, 0, Number.MAX_SAFE_INTEGER)
  };
}
function parseLeaseResult(result) {
  requireExactKeys(result, [
    "method",
    "accessToken",
    "expiresAtMs",
    "generation",
    "audience",
    "scopes"
  ]);
  if (typeof result.accessToken !== "string" || result.accessToken.length === 0 || result.accessToken.length > MAX_ACCESS_TOKEN_LENGTH || result.audience !== AUTH_LEASE_AUDIENCE || !Array.isArray(result.scopes) || result.scopes.length !== 1 || result.scopes[0] !== AUTH_LEASE_SCOPES[0]) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return {
    method: "lease",
    accessToken: result.accessToken,
    expiresAtMs: requireBoundedInteger(result.expiresAtMs, 0, Number.MAX_SAFE_INTEGER),
    generation: requireBoundedInteger(result.generation, 0, Number.MAX_SAFE_INTEGER),
    audience: AUTH_LEASE_AUDIENCE,
    scopes: AUTH_LEASE_SCOPES
  };
}
function parseUnauthorizedResult(result) {
  requireExactKeys(result, ["method", "action"]);
  if (result.action !== "retry" && result.action !== "logout") {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return { method: "unauthorized", action: result.action };
}
function requireRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return value;
}
function requireExactKeys(record, allowed) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
}
function requireRequestId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REQUEST_ID_LENGTH || !REQUEST_ID_PATTERN.test(value)) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return value;
}
function requireBoundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return value;
}
function requireErrorCode(value) {
  if (typeof value !== "string" || !(value in ERROR_MESSAGES)) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return value;
}

// node_modules/.pnpm/@alran+oauth-lease-protocol@0.1.0-beta.0/node_modules/@alran/oauth-lease-protocol/dist/codec.js
var FRAME_PREFIX_BYTES = 4;
function encodeAuthLeaseFrame(value) {
  let payload;
  try {
    payload = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  if (payload.length === 0 || payload.length > AUTH_LEASE_MAX_FRAME_BYTES) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  const prefix = Buffer.allocUnsafe(FRAME_PREFIX_BYTES);
  prefix.writeUInt32BE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}
var AuthLeaseFrameDecoder = class {
  buffer = Buffer.alloc(0);
  get bufferedBytes() {
    return this.buffer.length;
  }
  push(chunk) {
    if (chunk.byteLength === 0)
      return [];
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const frames = [];
    while (this.buffer.length >= FRAME_PREFIX_BYTES) {
      const payloadLength = this.buffer.readUInt32BE(0);
      if (payloadLength === 0 || payloadLength > AUTH_LEASE_MAX_FRAME_BYTES) {
        this.buffer = Buffer.alloc(0);
        throw new AuthLeaseProtocolError("INVALID_REQUEST");
      }
      const frameLength = FRAME_PREFIX_BYTES + payloadLength;
      if (this.buffer.length < frameLength) {
        if (this.buffer.length > AUTH_LEASE_MAX_FRAME_BYTES + FRAME_PREFIX_BYTES) {
          this.buffer = Buffer.alloc(0);
          throw new AuthLeaseProtocolError("INVALID_REQUEST");
        }
        return frames;
      }
      const payload = this.buffer.subarray(FRAME_PREFIX_BYTES, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      try {
        frames.push(JSON.parse(payload.toString("utf8")));
      } catch {
        this.buffer = Buffer.alloc(0);
        throw new AuthLeaseProtocolError("INVALID_REQUEST");
      }
    }
    return frames;
  }
};

// node_modules/.pnpm/@alran+oauth-lease-protocol@0.1.0-beta.0/node_modules/@alran/oauth-lease-protocol/dist/endpoints.js
import path from "node:path";
var SOCKET_FILE = "alran-auth-lease-v1.sock";
var CAPABILITY_FILE = "alran-auth-lease-v1.cap";
var WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\alran-auth-lease-";
function assertAuthLeaseClientEndpoint(endpoint, capabilityFile, platform = process.platform) {
  if (platform === "win32") {
    if (!endpoint.startsWith(WINDOWS_PIPE_PREFIX) || endpoint.length !== WINDOWS_PIPE_PREFIX.length + 16 || !/^[a-f0-9]{16}$/u.test(endpoint.slice(WINDOWS_PIPE_PREFIX.length)) || !path.win32.isAbsolute(capabilityFile) || path.win32.basename(capabilityFile) !== CAPABILITY_FILE) {
      throw new AuthLeaseProtocolError("INVALID_REQUEST");
    }
    return;
  }
  if (!path.isAbsolute(endpoint) || !path.isAbsolute(capabilityFile) || path.basename(endpoint) !== SOCKET_FILE || path.basename(capabilityFile) !== CAPABILITY_FILE) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  if (path.dirname(endpoint) !== path.dirname(capabilityFile)) {
    throw new TypeError("OAuth lease endpoint and capability file must share one run directory.");
  }
}

// node_modules/.pnpm/@alran+oauth-lease-protocol@0.1.0-beta.0/node_modules/@alran/oauth-lease-protocol/dist/node-client.js
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import net from "node:net";
var DEFAULT_CONNECT_TIMEOUT_MS = 5e3;
var DEFAULT_REQUEST_TIMEOUT_MS = 1e4;
function createNodeAuthLeaseClient(options) {
  assertAuthLeaseClientEndpoint(options.endpoint, options.capabilityFile);
  const connectTimeoutMs = requirePositiveInteger(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
  const requestTimeoutMs = requirePositiveInteger(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const pending = /* @__PURE__ */ new Map();
  let socket;
  let connectionPromise;
  let capability;
  let closed = false;
  async function request(build, expectedMethod) {
    if (closed)
      throw new AuthLeaseProtocolError("BROKER_UNAVAILABLE");
    const connected = await ensureConnected();
    const requestId = randomUUID();
    const requestValue = build(requestId, capability);
    return await new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new AuthLeaseProtocolError("BROKER_UNAVAILABLE"));
      }, requestTimeoutMs);
      pending.set(requestId, {
        expectedMethod,
        resolve: resolve3,
        reject,
        timer
      });
      connected.write(encodeAuthLeaseFrame(requestValue), (error) => {
        if (!error)
          return;
        const current = pending.get(requestId);
        if (!current)
          return;
        clearTimeout(current.timer);
        pending.delete(requestId);
        current.reject(new AuthLeaseProtocolError("BROKER_UNAVAILABLE"));
      });
    });
  }
  async function ensureConnected() {
    if (socket && !socket.destroyed)
      return socket;
    if (connectionPromise)
      return await connectionPromise;
    connectionPromise = connect(options, connectTimeoutMs, pending).then((connected) => {
      socket = connected;
      return loadCapability(options.capabilityFile).then((secret) => {
        capability = secret;
        return connected;
      });
    });
    try {
      return await connectionPromise;
    } catch {
      socket?.destroy();
      socket = void 0;
      capability = void 0;
      throw new AuthLeaseProtocolError("BROKER_UNAVAILABLE");
    } finally {
      connectionPromise = void 0;
    }
  }
  return {
    async getStatus() {
      const result = await request((requestId, secret) => ({
        version: 1,
        requestId,
        capability: secret,
        method: "status"
      }), "status");
      return result;
    },
    async getLease(minValidityMs) {
      const result = await request((requestId, secret) => ({
        version: 1,
        requestId,
        capability: secret,
        method: "lease",
        minValidityMs
      }), "lease");
      return result;
    },
    async handleUnauthorized(generation) {
      const result = await request((requestId, secret) => ({
        version: 1,
        requestId,
        capability: secret,
        method: "unauthorized",
        generation
      }), "unauthorized");
      return result;
    },
    close() {
      if (closed)
        return;
      closed = true;
      socket?.destroy();
      socket = void 0;
      capability = void 0;
      rejectPending(pending, "BROKER_UNAVAILABLE");
    }
  };
}
function connect(options, timeoutMs, pending) {
  return new Promise((resolve3, reject) => {
    const socket = net.createConnection(options.endpoint);
    const decoder = new AuthLeaseFrameDecoder();
    let connected = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new AuthLeaseProtocolError("BROKER_UNAVAILABLE"));
    }, timeoutMs);
    const fail2 = () => {
      clearTimeout(timeout);
      if (!connected)
        reject(new AuthLeaseProtocolError("BROKER_UNAVAILABLE"));
      rejectPending(pending, "BROKER_UNAVAILABLE");
    };
    socket.once("connect", () => {
      connected = true;
      clearTimeout(timeout);
      resolve3(socket);
    });
    socket.on("data", (chunk) => {
      let frames;
      try {
        frames = decoder.push(chunk);
      } catch {
        socket.destroy();
        rejectPending(pending, "INVALID_REQUEST");
        return;
      }
      for (const frame of frames)
        settleResponse(frame, pending);
    });
    socket.on("error", fail2);
    socket.on("close", fail2);
  });
}
function settleResponse(frame, pending) {
  let response;
  try {
    response = parseAuthLeaseResponse(frame);
  } catch {
    rejectPending(pending, "INVALID_REQUEST");
    return;
  }
  const request = pending.get(response.requestId);
  if (!request)
    return;
  clearTimeout(request.timer);
  pending.delete(response.requestId);
  if (!response.ok) {
    request.reject(new AuthLeaseProtocolError(response.error.code));
    return;
  }
  if (response.result.method !== request.expectedMethod) {
    request.reject(new AuthLeaseProtocolError("INVALID_REQUEST"));
    return;
  }
  request.resolve(response.result);
}
function rejectPending(pending, code) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new AuthLeaseProtocolError(code));
  }
  pending.clear();
}
async function loadCapability(capabilityFile) {
  try {
    if (process.platform !== "win32") {
      const metadata = await stat(capabilityFile);
      if ((metadata.mode & 63) !== 0)
        throw new Error("not private");
    }
    const secret = (await readFile(capabilityFile, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(secret))
      throw new Error("invalid capability");
    return secret;
  } catch {
    throw new AuthLeaseProtocolError("BROKER_UNAVAILABLE");
  }
}
function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AuthLeaseProtocolError("INVALID_REQUEST");
  }
  return value;
}

// src/auth/providers/shared-broker.ts
var defaultDependencies = {
  createClient: createNodeAuthLeaseClient
};
function createSharedBrokerAuthProvider(config, dependencies = defaultDependencies) {
  if (config.authProviderMode !== "shared-broker" || !config.authBrokerEndpoint || !config.authBrokerCapabilityFile) {
    throw new Error("Shared-broker authentication is not configured.");
  }
  const client = dependencies.createClient({
    endpoint: config.authBrokerEndpoint,
    capabilityFile: config.authBrokerCapabilityFile
  });
  return {
    mode: "shared-broker",
    async getAccessToken(request) {
      try {
        const lease = await client.getLease(request.minValidityMs);
        return {
          accessToken: lease.accessToken,
          expiresAtMs: lease.expiresAtMs,
          generation: lease.generation,
          scopes: lease.scopes,
          audience: lease.audience
        };
      } catch (cause) {
        throw sharedBrokerError(cause);
      }
    },
    async handleUnauthorized(context) {
      try {
        return (await client.handleUnauthorized(context.generation)).action;
      } catch (cause) {
        throw sharedBrokerError(cause);
      }
    },
    async getStatus() {
      try {
        const snapshot = await client.getStatus();
        return brokerStatus(snapshot);
      } catch (cause) {
        throw sharedBrokerError(cause);
      }
    },
    dispose() {
      client.close();
    }
  };
}
function brokerStatus(snapshot) {
  const grantsLease = snapshot.status === "authenticated" || snapshot.status === "refreshing";
  return {
    status: snapshot.status,
    generation: snapshot.generation,
    scopes: grantsLease ? ["agent.default"] : [],
    ...snapshot.expiresAtMs === void 0 ? {} : { expiresAtMs: snapshot.expiresAtMs }
  };
}
function sharedBrokerError(cause) {
  const code = protocolErrorCode(cause);
  const messages = {
    AUTH_REQUIRED: "Alran host authentication is required. Sign in through the Alran host.",
    BROKER_UNAVAILABLE: "Alran host authentication broker is unavailable. Open or restart the Alran host.",
    CAPABILITY_REJECTED: "Alran host authentication capability was rejected. Restart the Alran host.",
    PROTOCOL_MISMATCH: "Alran host authentication protocol is incompatible. Update the Alran host and alran-tools.",
    INVALID_REQUEST: "Alran host authentication request is invalid. Update the Alran host and alran-tools.",
    INTERNAL_ERROR: "Alran host authentication request failed. Retry from the Alran host."
  };
  return new Error(
    code ? messages[code] : "Alran host authentication request failed.",
    { cause }
  );
}
function protocolErrorCode(cause) {
  if (!cause || typeof cause !== "object" || !("code" in cause)) return void 0;
  const code = cause.code;
  return typeof code === "string" && [
    "AUTH_REQUIRED",
    "BROKER_UNAVAILABLE",
    "CAPABILITY_REJECTED",
    "PROTOCOL_MISMATCH",
    "INVALID_REQUEST",
    "INTERNAL_ERROR"
  ].includes(code) ? code : void 0;
}

// src/auth/provider-factory-embedded.ts
var defaultDependencies2 = {
  createSharedBrokerAuthProvider
};
function createEmbeddedAuthProvider(config, dependencies = defaultDependencies2) {
  if (config.isSandbox || config.authProviderMode !== "shared-broker") {
    throw new Error(
      "Embedded alran-tools requires ALRAN_AUTH_PROVIDER=shared-broker from the Alran host."
    );
  }
  return dependencies.createSharedBrokerAuthProvider(config);
}

// node_modules/.pnpm/commander@12.1.0/node_modules/commander/esm.mjs
var import_index = __toESM(require_commander(), 1);
var {
  program,
  createCommand,
  createArgument,
  createOption,
  CommanderError,
  InvalidArgumentError,
  InvalidOptionArgumentError,
  // deprecated old name
  Command,
  Argument,
  Option,
  Help
} = import_index.default;

// src/build-info.ts
var BUILD_ENV = "prod";
var BEDROCK_LANE = "";
var PACKAGE_VERSION = "0.0.4";

// src/config.ts
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// src/env-profiles.ts
var ENV_PROFILES = {
  test: {
    authBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    apiBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    clientId: "alran_tool",
    scope: "agent.mcp.matrix agent.mcp.app",
    useBedrockLane: true
  },
  staging: {
    authBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    apiBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    clientId: "alran_tool",
    scope: "agent.mcp.matrix agent.mcp.app",
    useBedrockLane: false
  },
  prod: {
    authBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    apiBaseUrls: {
      cn: "https://api.ottili.one",
      en: "https://api.ottili.one"
    },
    clientId: "alran_tool",
    scope: "agent.mcp.matrix agent.mcp.app",
    useBedrockLane: false
  }
};
function bedrockLaneHeaders(lane) {
  const value = lane.trim();
  if (!value) return {};
  return { bedrock_lane: value, "bedrock-lane": value };
}

// src/config.ts
var PROFILE = ENV_PROFILES[BUILD_ENV];
var DEFAULT_CLIENT_ID = PROFILE.clientId;
var DEFAULT_SCOPE = PROFILE.scope;
var DEFAULT_EXTRA_HEADERS = PROFILE.useBedrockLane ? bedrockLaneHeaders(BEDROCK_LANE) : {};
function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}
function resolveRegion() {
  const raw = process.env.ALRAN_REGION?.trim().toLowerCase();
  if (!raw || raw === "cn") return "cn";
  if (raw === "en") return "en";
  throw new Error(`Invalid ALRAN_REGION ${JSON.stringify(raw)}; expected "cn" or "en".`);
}
function resolveConfigDir() {
  const override = process.env.ALRAN_CONFIG_DIR;
  if (override && override.trim().length > 0) {
    return override;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim().length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "alran-tools");
}
function resolveNodeMapPath(isSandbox) {
  const sandboxHome = isSandbox ? process.env.HOME?.trim() : void 0;
  return join(sandboxHome || homedir(), ".alran", "alran-tools-node-map.json");
}
function resolveAuthProviderMode(isSandbox) {
  const raw = process.env.ALRAN_AUTH_PROVIDER?.trim();
  if (raw && raw !== "standalone-file" && raw !== "shared-broker" && raw !== "sandbox-egress") {
    throw new Error(
      `Invalid ALRAN_AUTH_PROVIDER ${JSON.stringify(raw)}; expected "standalone-file", "shared-broker", or "sandbox-egress".`
    );
  }
  if (isSandbox) {
    if (raw && raw !== "sandbox-egress") {
      throw new Error(
        "IS_SANDBOX=1 requires ALRAN_AUTH_PROVIDER=sandbox-egress when the provider is explicit."
      );
    }
    return "sandbox-egress";
  }
  if (raw === "sandbox-egress") {
    throw new Error("ALRAN_AUTH_PROVIDER=sandbox-egress requires IS_SANDBOX=1.");
  }
  if (raw === "shared-broker" || raw === "standalone-file") return raw;
  return "standalone-file";
}
function resolveAuthBrokerCoordinates(mode) {
  if (mode !== "shared-broker") return void 0;
  const endpoint = process.env.ALRAN_AUTH_BROKER_ENDPOINT?.trim();
  const capabilityFile = process.env.ALRAN_AUTH_BROKER_CAPABILITY_FILE?.trim();
  if (!endpoint || !capabilityFile) {
    throw new Error(
      "ALRAN_AUTH_BROKER_ENDPOINT and ALRAN_AUTH_BROKER_CAPABILITY_FILE are both required when ALRAN_AUTH_PROVIDER=shared-broker."
    );
  }
  if (/\r|\n|\0/u.test(endpoint) || /\r|\n|\0/u.test(capabilityFile) || process.platform !== "win32" && (!isAbsolute(endpoint) || !isAbsolute(capabilityFile) || resolve(endpoint) !== endpoint || resolve(capabilityFile) !== capabilityFile)) {
    throw new Error(
      "Alran auth broker coordinates must use canonical paths without control characters."
    );
  }
  try {
    assertAuthLeaseClientEndpoint(endpoint, capabilityFile);
  } catch (cause) {
    throw new Error(
      "Alran auth broker endpoint and capability file must use the canonical lease protocol locations.",
      { cause }
    );
  }
  return {
    authBrokerEndpoint: endpoint,
    authBrokerCapabilityFile: capabilityFile
  };
}
function resolveExtraHeaders() {
  const raw = process.env.ALRAN_EXTRA_HEADERS;
  if (raw === void 0) return { ...DEFAULT_EXTRA_HEADERS };
  const out = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
function loadConfig() {
  const region = resolveRegion();
  const isSandbox = process.env.IS_SANDBOX === "1";
  const authProviderMode = resolveAuthProviderMode(isSandbox);
  const authBrokerCoordinates = resolveAuthBrokerCoordinates(authProviderMode);
  const authBaseUrl = stripTrailingSlash(
    process.env.ALRAN_AUTH_BASE_URL?.trim() || PROFILE.authBaseUrls[region]
  );
  const apiBaseUrlOverride = process.env.ALRAN_API_BASE_URL?.trim();
  if (authProviderMode === "shared-broker" && apiBaseUrlOverride) {
    throw new Error(
      "ALRAN_API_BASE_URL cannot be overridden in shared-broker mode."
    );
  }
  const apiBaseUrl = stripTrailingSlash(
    apiBaseUrlOverride || PROFILE.apiBaseUrls[region]
  );
  const clientId = process.env.ALRAN_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID;
  const scope = process.env.ALRAN_SCOPE?.trim() || DEFAULT_SCOPE;
  const extraHeaders = resolveExtraHeaders();
  const configDir = resolveConfigDir();
  return {
    buildEnv: BUILD_ENV,
    isSandbox,
    authProviderMode,
    ...authBrokerCoordinates,
    authBaseUrl,
    apiBaseUrl,
    region,
    clientId,
    scope,
    extraHeaders,
    configDir,
    credentialsPath: join(configDir, "credentials.json"),
    electronAuthStatePath: join(configDir, "electron-auth-state.json"),
    nodeMapPath: resolveNodeMapPath(isSandbox)
  };
}

// src/commands/auth-json.ts
var emitAuthJson = (event) => {
  console.log(JSON.stringify(event));
};

// src/commands/auth-status-managed.ts
function createManagedAuthStatusDependencies(createAuthProvider) {
  return { loadConfig, createAuthProvider, emit: emitAuthJson };
}
async function managedAuthStatusCommand(dependencies) {
  const config = dependencies.loadConfig();
  if (config.authProviderMode !== "shared-broker") {
    throw new Error("Embedded alran-tools authentication is not configured.");
  }
  const provider = dependencies.createAuthProvider(config);
  const snapshot = await provider.getStatus?.();
  if (!snapshot) {
    throw new Error("Shared-broker authentication status is unavailable.");
  }
  dependencies.emit({
    event: "status",
    auth_mode: "shared-broker",
    status: snapshot.status,
    generation: snapshot.generation,
    scope: [...snapshot.scopes].sort().join(" "),
    expires_at_ms: snapshot.expiresAtMs ?? null
  });
}

// src/commands/connector-call.ts
import { readFileSync } from "node:fs";

// src/logger.ts
import {
  closeSync,
  constants,
  fchmodSync,
  mkdirSync,
  openSync,
  writeSync
} from "node:fs";
import { dirname, join as join2 } from "node:path";
function diagnosticLog(event, fields = {}) {
  const logFile = resolveLogFile();
  if (!logFile) return;
  const entry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    pid: process.pid,
    event,
    ...safeFields(fields)
  };
  let fileDescriptor;
  try {
    mkdirSync(dirname(logFile), { recursive: true, mode: 448 });
    fileDescriptor = openSync(
      logFile,
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
      384
    );
    fchmodSync(fileDescriptor, 384);
    writeSync(fileDescriptor, `${JSON.stringify(entry)}
`, void 0, "utf8");
  } catch {
  } finally {
    if (fileDescriptor !== void 0) closeSync(fileDescriptor);
  }
}
function resolveLogFile() {
  const override = process.env.ALRAN_LOG_FILE;
  if (override !== void 0) {
    const value = override.trim();
    if (!value || value.toLowerCase() === "off") return void 0;
    return value;
  }
  const userId = typeof process.getuid === "function" ? process.getuid() : "user";
  return join2("/tmp", `alran-tools-${userId}`, "alran-tools.log");
}
function safeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry) => entry[1] !== void 0
    ).map(([key, value]) => [
      key,
      /(authorization|token|credential|secret|body|args|arguments|result)/i.test(key) ? "<redacted>" : value
    ])
  );
}

// src/api/client.ts
var ApiError = class extends Error {
  constructor(message, kind, httpStatus, statusCode) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.statusCode = statusCode;
    this.name = "ApiError";
  }
};
var MIN_ACCESS_TOKEN_VALIDITY_MS = 6e4;
async function postApiJson(config, path2, body, provider, options) {
  if (config.isSandbox !== (provider.mode === "sandbox-egress")) {
    throw new Error("Business auth mode does not match IS_SANDBOX configuration.");
  }
  if (config.authProviderMode !== provider.mode) {
    throw new Error("Auth provider mode does not match configuration.");
  }
  const url = `${config.apiBaseUrl}${path2}`;
  const logUrl = safeLogUrl(url);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const auth = await resolveRequestAuth(provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();
    diagnosticLog("business_api.request", {
      method: "POST",
      url: logUrl,
      timeout_ms: options.timeoutMs,
      auth_mode: provider.mode,
      retry: attempt === 1
    });
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: businessHeaders(config.extraHeaders, auth),
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      diagnosticLog("business_api.network_error", {
        method: "POST",
        url: logUrl,
        duration_ms: Date.now() - startedAt,
        timed_out: controller.signal.aborted
      });
      if (controller.signal.aborted) {
        throw new ApiError(
          `Request timed out after ${options.timeoutMs}ms: ${path2}`,
          "timeout"
        );
      }
      const detail = redactToken(
        cause instanceof Error ? cause.message : String(cause),
        auth
      );
      throw new ApiError(
        `Network request failed for ${path2}: ${detail}`,
        "network"
      );
    } finally {
      clearTimeout(timeout);
    }
    const text = await response.text();
    diagnosticLog("business_api.response", {
      method: "POST",
      url: logUrl,
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      request_id: responseRequestId(response.headers)
    });
    if (!response.ok) {
      if (response.status === 401 && attempt === 0) {
        const action = await provider.handleUnauthorized({
          generation: auth.mode === "bearer" ? auth.generation : 0
        });
        if (action === "retry") continue;
      }
      const parsed2 = parseErrorResponseBody(text);
      throw httpError(response.status, parsed2, path2, auth, provider.mode);
    }
    const parsed = parseResponseBody(text, path2, response.status);
    const baseResp = parseBaseResp(parsed.base_resp, path2, response.status);
    const statusCode = normalizeStatusCode(baseResp?.status_code);
    if (baseResp?.status_code !== void 0 && statusCode === void 0) {
      throw new ApiError(
        `Invalid base_resp.status_code from ${path2}`,
        "invalid_response",
        response.status
      );
    }
    if (statusCode !== void 0 && statusCode !== 0) {
      const message = redactToken(
        baseResp?.status_msg?.trim() || "Business request failed",
        auth
      );
      throw new ApiError(
        `${message} (status_code=${statusCode}, path=${path2})`,
        "business",
        response.status,
        statusCode
      );
    }
    return parsed;
  }
  throw new Error("Unreachable Resource API retry state.");
}
async function resolveRequestAuth(provider) {
  const lease = await provider.getAccessToken({
    minValidityMs: MIN_ACCESS_TOKEN_VALIDITY_MS
  });
  if (provider.mode === "sandbox-egress") {
    if (lease !== null) {
      throw new Error("Sandbox egress authentication must not expose an access token.");
    }
    return { mode: "sandbox_egress" };
  }
  if (!lease) {
    throw new Error("Bearer authentication provider returned no access token lease.");
  }
  return {
    mode: "bearer",
    accessToken: lease.accessToken,
    generation: lease.generation
  };
}
function safeLogUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}
function responseRequestId(headers) {
  return headers.get("x-request-id") ?? headers.get("request-id") ?? headers.get("x-trace-id") ?? void 0;
}
function businessHeaders(extraHeaders, auth) {
  const headers = { "Content-Type": "application/json" };
  for (const [key, value] of Object.entries(extraHeaders)) {
    const normalized = key.toLowerCase();
    if (normalized === "authorization" || normalized === "token" || normalized === "content-type") {
      continue;
    }
    headers[key] = value;
  }
  if (auth.mode === "bearer") {
    headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  return headers;
}
function parseResponseBody(text, path2, status) {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("response is not a JSON object");
    }
    return value;
  } catch {
    throw new ApiError(`Invalid JSON response from ${path2} (HTTP ${status})`, "invalid_json", status);
  }
}
function parseErrorResponseBody(text) {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  } catch {
    return {};
  }
}
function httpError(status, body, path2, auth, providerMode) {
  if (status === 401) {
    if (auth.mode === "sandbox_egress") {
      return new ApiError(
        "Sandbox authentication failed: credential injection is unavailable or the managed credential is invalid.",
        "http",
        status
      );
    }
    if (providerMode === "shared-broker") {
      return new ApiError(
        "Authentication failed. Return to the Alran host to refresh or sign in again.",
        "http",
        status
      );
    }
    return new ApiError(
      "Authentication failed. Refresh or sign in through the configured authentication owner, then try again.",
      "http",
      status
    );
  }
  if (status === 403) {
    if (auth.mode === "sandbox_egress") {
      return new ApiError(
        "Permission denied: the sandbox-managed credential does not have the required scope.",
        "http",
        status
      );
    }
    return new ApiError("Permission denied: the access token does not have the required scope.", "http", status);
  }
  const message = redactToken(
    firstString(body.error, body.message, body.base_resp?.status_msg) || `HTTP ${status}`,
    auth
  );
  return new ApiError(`${message} (path=${path2})`, "http", status);
}
function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return void 0;
}
function normalizeStatusCode(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return void 0;
  return Number(value);
}
function parseBaseResp(value, path2, status) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(`Invalid base_resp from ${path2}`, "invalid_response", status);
  }
  return value;
}
function redactToken(value, auth) {
  return auth.mode === "bearer" ? value.replaceAll(auth.accessToken, "<redacted>") : value;
}

// src/api/connector-types.ts
function validateListConnectedTools(value) {
  if (!Array.isArray(value.tools)) throw new Error("Invalid response: tools must be an array.");
  if (!Array.isArray(value.provider_failures)) {
    throw new Error("Invalid response: provider_failures must be an array.");
  }
  if (typeof value.partial !== "boolean") {
    throw new Error("Invalid response: partial must be a boolean.");
  }
  for (const tool of value.tools) validateTool(tool);
  for (const failure of value.provider_failures) validateProviderFailure(failure);
  return value;
}
function validateCallConnectorTool(value) {
  optionalBoolean(value.is_error, "is_error");
  optionalString(value.result_json, "result_json");
  optionalString(value.error_code, "error_code");
  optionalString(value.error_message, "error_message");
  optionalString(value.provider_usage_json, "provider_usage_json");
  if (value.latency_ms !== void 0 && typeof value.latency_ms !== "number") {
    throw new Error("Invalid response: latency_ms must be a number.");
  }
  return value;
}
function validateTool(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid response: tool must be an object.");
  }
  const tool = value;
  requiredString(tool.provider, "tool.provider");
  requiredString(tool.provider_tool_name, "tool.provider_tool_name");
  requiredString(tool.runtime_tool_name, "tool.runtime_tool_name");
  requiredString(tool.input_schema_json, "tool.input_schema_json");
  optionalString(tool.description, "tool.description");
  optionalString(tool.output_schema_json, "tool.output_schema_json");
}
function validateProviderFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid response: provider failure must be an object.");
  }
  const failure = value;
  requiredString(failure.provider, "provider_failure.provider");
  requiredString(failure.code, "provider_failure.code");
  requiredString(failure.message, "provider_failure.message");
  optionalBoolean(failure.retryable, "provider_failure.retryable");
}
function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid response: ${field} must be a non-empty string.`);
  }
}
function optionalString(value, field) {
  if (value !== void 0 && typeof value !== "string") {
    throw new Error(`Invalid response: ${field} must be a string.`);
  }
}
function optionalBoolean(value, field) {
  if (value !== void 0 && typeof value !== "boolean") {
    throw new Error(`Invalid response: ${field} must be a boolean.`);
  }
}

// src/api/connectors.ts
var LIST_CONNECTED_TOOLS_PATH = "/alran-cloud/api/v1/connectors/connected-tools/list";
var CALL_CONNECTOR_TOOL_PATH = "/alran-cloud/api/v1/connectors/tools/call";
var LIST_TIMEOUT_MS = 3e4;
var CALL_TIMEOUT_MS = 10 * 6e4;
async function listConnectedConnectorTools(config, provider) {
  const response = await postApiJson(
    config,
    LIST_CONNECTED_TOOLS_PATH,
    {},
    provider,
    { timeoutMs: LIST_TIMEOUT_MS }
  );
  return validateListConnectedTools(response);
}
async function callConnectorTool(config, provider, request) {
  const response = await postApiJson(
    config,
    CALL_CONNECTOR_TOOL_PATH,
    { ...request },
    provider,
    { timeoutMs: CALL_TIMEOUT_MS }
  );
  return validateCallConnectorTool(response);
}
function findConnectorTool(response, toolName) {
  const matches = response.tools.filter((tool) => tool.runtime_tool_name === toolName);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Invalid response: duplicate tool_name ${JSON.stringify(toolName)}.`);
  }
  const provider = providerFromToolName(toolName);
  const failure = provider ? response.provider_failures.find((item) => item.provider === provider) : void 0;
  if (failure) {
    throw new Error(
      `Connector provider ${failure.provider} is unavailable: ${failure.code} \u2014 ${failure.message}`
    );
  }
  throw new Error(
    `Connector tool_name ${JSON.stringify(toolName)} is not available. Run \`alran-tools connector tools\` to list available tools.`
  );
}
function providerFromToolName(toolName) {
  const match = /^connector__(.+?)__/.exec(toolName);
  return match?.[1];
}

// src/api/matrix-tools.ts
var GET_ASSET_URL_TOOL_NAME = "connector__matrix__get_asset_url";
var UPLOAD_TEMP_URL_TOOL_NAME = "connector__matrix__upload_temp_url";
function isCliOwnedMatrixTool(toolName) {
  return toolName === GET_ASSET_URL_TOOL_NAME || toolName === UPLOAD_TEMP_URL_TOOL_NAME;
}
function cliOwnedToolError(toolName) {
  if (isCliOwnedMatrixTool(toolName)) {
    if (toolName === UPLOAD_TEMP_URL_TOOL_NAME) {
      return new Error(
        "connector__matrix__upload_temp_url is exposed as a top-level command. Run `alran-tools upload-temp-url <file_path>`."
      );
    }
    return new Error(
      "connector__matrix__get_asset_url is exposed as a top-level command. Run `alran-tools get-asset-url <node_id>`."
    );
  }
  return new Error(`Connector tool ${JSON.stringify(toolName)} is CLI-owned.`);
}

// src/commands/connector-output.ts
function printConnectedTools(response, keyword) {
  printJson(buildConnectedToolsOutput(response, keyword));
}
function buildConnectedToolsOutput(response, keyword) {
  const normalizedKeyword = keyword?.trim().toLocaleLowerCase() ?? "";
  const tools = response.tools.filter((tool) => !isCliOwnedMatrixTool(tool.runtime_tool_name)).filter((tool) => matchesKeyword(tool, normalizedKeyword)).slice().sort((a, b) => a.runtime_tool_name.localeCompare(b.runtime_tool_name)).map((tool) => ({
    tool_name: tool.runtime_tool_name,
    description: singleLine(tool.description ?? "")
  }));
  return {
    tools,
    partial: response.partial,
    provider_failures: response.provider_failures
  };
}
function printConnectorToolDetail(tool) {
  printJson(buildConnectorToolDetail(tool));
}
function buildConnectorToolDetail(tool) {
  return {
    tool_name: tool.runtime_tool_name,
    description: singleLine(tool.description ?? ""),
    input_schema: parseSchema(tool.input_schema_json, "input_schema_json"),
    output_schema: tool.output_schema_json === void 0 ? null : parseSchema(tool.output_schema_json, "output_schema_json")
  };
}
function printConnectorCall(resultJson) {
  console.log(resultJson?.trim() ? resultJson : "{}");
}
function printRawConnectorCall(response) {
  printJson(response);
}
function connectorToolError(response) {
  const code = response.error_code?.trim() || "connector_tool_error";
  const message = response.error_message?.trim() || "Connector tool execution failed";
  const latency = response.latency_ms === void 0 ? "" : ` (latency_ms=${response.latency_ms})`;
  return new Error(`${code}: ${message}${latency}`);
}
function matchesKeyword(tool, keyword) {
  if (!keyword) return true;
  return `${tool.runtime_tool_name}
${tool.description ?? ""}`.toLocaleLowerCase().includes(keyword);
}
function parseSchema(value, field) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid Connector ${field}: expected valid JSON.`);
  }
}
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
function singleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

// src/commands/connector-call.ts
function createConnectorCallDependencies(createAuthProvider) {
  return {
    loadConfig,
    createAuthProvider,
    listConnectedConnectorTools,
    callConnectorTool,
    readText: (path2) => readFileSync(path2, "utf8")
  };
}
async function connectorCallCommand(toolName, options, dependencies) {
  if (isCliOwnedMatrixTool(toolName)) throw cliOwnedToolError(toolName);
  const argumentsJson = readArgumentsJson(options, dependencies.readText);
  const config = dependencies.loadConfig();
  const provider = dependencies.createAuthProvider(config);
  const tools = await dependencies.listConnectedConnectorTools(config, provider);
  const tool = findConnectorTool(tools, toolName);
  const response = await dependencies.callConnectorTool(config, provider, {
    provider: tool.provider,
    provider_tool_name: tool.provider_tool_name,
    runtime_tool_name: tool.runtime_tool_name,
    arguments_json: argumentsJson
  });
  if (response.is_error === true) throw connectorToolError(response);
  if (options.raw === true) {
    printRawConnectorCall(response);
  } else {
    printConnectorCall(response.result_json);
  }
}
function readArgumentsJson(options, readText = (path2) => readFileSync(path2, "utf8")) {
  if (options.args !== void 0 && options.argsFile !== void 0) {
    throw new Error("--args and --args-file cannot be used together.");
  }
  const source = options.argsFile !== void 0 ? readText(options.argsFile === "-" ? 0 : options.argsFile) : options.args ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Connector arguments must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Connector arguments must be a JSON object.");
  }
  return JSON.stringify(parsed);
}

// src/commands/connector-tool.ts
function createConnectorToolDependencies(createAuthProvider) {
  return { loadConfig, createAuthProvider, listConnectedConnectorTools };
}
async function connectorToolCommand(toolName, dependencies) {
  if (isCliOwnedMatrixTool(toolName)) throw cliOwnedToolError(toolName);
  const config = dependencies.loadConfig();
  const provider = dependencies.createAuthProvider(config);
  const tools = await dependencies.listConnectedConnectorTools(config, provider);
  const tool = findConnectorTool(tools, toolName);
  printConnectorToolDetail(tool);
}

// src/commands/connector-tools.ts
function createConnectorToolsDependencies(createAuthProvider) {
  return { loadConfig, createAuthProvider, listConnectedConnectorTools };
}
async function connectorToolsCommand(options, dependencies) {
  const config = dependencies.loadConfig();
  const provider = dependencies.createAuthProvider(config);
  const response = await dependencies.listConnectedConnectorTools(
    config,
    provider
  );
  printConnectedTools(response, options.keyword);
}

// src/commands/get-asset-url.ts
import { createHash } from "node:crypto";

// src/store/node-map.ts
import {
  chmodSync,
  existsSync,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync2,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname as dirname2, join as join3 } from "node:path";
var SHA256_PATTERN = /^[a-f0-9]{64}$/;
function readNodeMap(path2) {
  if (!existsSync(path2)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync2(path2, "utf8"));
  } catch {
    throw new Error(`Invalid node map at ${path2}: expected valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid node map at ${path2}: expected a JSON object.`);
  }
  const entries = Object.entries(parsed);
  for (const [sha256, nodeId] of entries) {
    if (!SHA256_PATTERN.test(sha256) || !isNonEmptyString(nodeId)) {
      throw new Error(
        `Invalid node map at ${path2}: expected lowercase SHA-256 keys and non-empty node ids.`
      );
    }
  }
  return Object.fromEntries(entries);
}
function recordNodeMapping(path2, sha256, nodeId) {
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error("SHA-256 must be 64 lowercase hexadecimal characters.");
  }
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) throw new Error("node_id must not be empty.");
  const dir = dirname2(path2);
  mkdirSync2(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
  const next = readNodeMap(path2);
  next[sha256] = normalizedNodeId;
  const tmp = join3(dir, `.node-map.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}
`, { mode: 384 });
  try {
    renameSync(tmp, path2);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
    }
    throw err;
  }
  chmodSync(path2, 384);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// src/commands/get-asset-url.ts
var DOWNLOAD_TIMEOUT_MS = 2 * 6e4;
function createGetAssetUrlDependencies(createAuthProvider) {
  return {
    loadConfig,
    createAuthProvider,
    listConnectedConnectorTools,
    callConnectorTool,
    fetchDownload: fetch,
    recordNodeMapping,
    print: (value) => console.log(JSON.stringify(value, null, 2))
  };
}
async function getAssetUrlCommand(nodeId, dependencies) {
  const normalizedNodeId = nodeId.trim();
  if (!normalizedNodeId) throw new Error("node_id must not be empty.");
  const config = dependencies.loadConfig();
  const provider = dependencies.createAuthProvider(config);
  const tools = await dependencies.listConnectedConnectorTools(config, provider);
  const tool = findConnectorTool(tools, GET_ASSET_URL_TOOL_NAME);
  const response = await dependencies.callConnectorTool(config, provider, {
    provider: tool.provider,
    provider_tool_name: tool.provider_tool_name,
    runtime_tool_name: tool.runtime_tool_name,
    arguments_json: JSON.stringify({ node_id: normalizedNodeId })
  });
  if (response.is_error === true) throw connectorToolError(response);
  const downloadUrl = parseDownloadUrl(response);
  const output = {
    node_id: normalizedNodeId,
    download_url: downloadUrl
  };
  if (config.isSandbox) {
    const sha256 = await sha256Download(downloadUrl, dependencies.fetchDownload);
    dependencies.recordNodeMapping(config.nodeMapPath, sha256, normalizedNodeId);
    output.sha256 = sha256;
  }
  dependencies.print(output);
}
async function sha256Download(downloadUrl, fetchDownload = fetch) {
  const url = downloadUrl.trim();
  validateDownloadUrl(url);
  let response;
  try {
    response = await fetchDownload(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to read get_asset_url result for SHA-256: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(
      `Failed to read get_asset_url result for SHA-256: HTTP ${response.status}.`
    );
  }
  if (!response.body) {
    throw new Error("Failed to read get_asset_url result for SHA-256: empty body.");
  }
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest("hex");
}
function parseDownloadUrl(response) {
  if (!response.result_json?.trim()) {
    throw new Error("Invalid get_asset_url response: result_json is missing.");
  }
  let result;
  try {
    result = JSON.parse(response.result_json);
  } catch {
    throw new Error("Invalid get_asset_url response: result_json must be valid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid get_asset_url response: expected a JSON object.");
  }
  const value = result;
  const code = normalizeCode(value.code);
  if (code !== 0) {
    const message = typeof value.message === "string" && value.message.trim() ? value.message.trim() : "request failed";
    throw new Error(`get_asset_url failed: ${message} (code=${String(value.code)}).`);
  }
  if (typeof value.download_url !== "string" || !value.download_url.trim()) {
    throw new Error("Invalid get_asset_url response: download_url is missing.");
  }
  const downloadUrl = value.download_url.trim();
  validateDownloadUrl(downloadUrl);
  return downloadUrl;
}
function validateDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid get_asset_url response: download_url must be a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      "Invalid get_asset_url response: download_url must use HTTP or HTTPS."
    );
  }
}
function normalizeCode(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value);
  }
  return void 0;
}

// src/commands/upload-temp-url.ts
import { readFile as readFile2, stat as stat2 } from "node:fs/promises";
import { basename, extname, resolve as resolve2 } from "node:path";

// src/media/iso-bmff-duration.ts
import { open } from "node:fs/promises";
var MAX_BOXES_PER_RANGE = 1e4;
async function readIsoBmffDurationSeconds(filePath) {
  const handle = await open(filePath, "r");
  try {
    const fileSize = (await handle.stat()).size;
    for await (const box of boxes(handle, 0, fileSize)) {
      if (box.type !== "moov") continue;
      const contentStart = box.start + box.headerSize;
      const contentEnd = box.start + box.size;
      for await (const child of boxes(handle, contentStart, contentEnd)) {
        if (child.type === "mvhd") return readMovieHeaderDuration(handle, child);
      }
    }
    return void 0;
  } finally {
    await handle.close();
  }
}
async function* boxes(handle, start, end) {
  let position = start;
  let boxCount = 0;
  while (position + 8 <= end) {
    boxCount += 1;
    if (boxCount > MAX_BOXES_PER_RANGE) {
      throw new Error("ISO BMFF box count exceeds the safety limit");
    }
    const base = await readExact(handle, position, 8);
    const size32 = base.readUInt32BE(0);
    const type = base.toString("ascii", 4, 8);
    let headerSize = 8;
    let size;
    if (size32 === 1) {
      const extended = await readExact(handle, position + 8, 8);
      const extendedSize = extended.readBigUInt64BE(0);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return;
      size = Number(extendedSize);
      headerSize = 16;
    } else {
      size = size32 === 0 ? end - position : size32;
    }
    if (size < headerSize || position + size > end) return;
    yield { type, start: position, size, headerSize };
    position += size;
  }
}
async function readMovieHeaderDuration(handle, box) {
  const payloadSize = box.size - box.headerSize;
  if (payloadSize < 20) return void 0;
  const payload = await readExact(handle, box.start + box.headerSize, Math.min(payloadSize, 32));
  const version = payload.readUInt8(0);
  if (version === 0 && payload.length >= 20) {
    return seconds(payload.readUInt32BE(12), BigInt(payload.readUInt32BE(16)));
  }
  if (version === 1 && payload.length >= 32) {
    return seconds(payload.readUInt32BE(20), payload.readBigUInt64BE(24));
  }
  return void 0;
}
function seconds(timescale, duration) {
  if (timescale <= 0) return void 0;
  const value = Number(duration) / timescale;
  return Number.isFinite(value) && value > 0 ? value : void 0;
}
async function readExact(handle, position, length) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("Unexpected end of ISO BMFF file");
    offset += bytesRead;
  }
  return buffer;
}

// src/commands/upload-temp-url.ts
var MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
var MAX_VIDEO_REFERENCE_BYTES = 50 * 1024 * 1024;
var UPLOAD_TIMEOUT_MS = 10 * 6e4;
function createUploadTempUrlDependencies(createAuthProvider) {
  return {
    loadConfig,
    createAuthProvider,
    listConnectedConnectorTools,
    callConnectorTool,
    statFile: stat2,
    readFileBytes: readFile2,
    readIsoBmffDurationSeconds,
    upload: fetch,
    print: (value) => console.log(JSON.stringify(value, null, 2))
  };
}
async function uploadTempUrlCommand(file, options, dependencies) {
  const normalizedFile = file.trim();
  if (!normalizedFile) throw new Error("file must not be empty.");
  const absoluteFile = resolve2(normalizedFile);
  const fileInfo = await dependencies.statFile(absoluteFile).catch(() => null);
  if (!fileInfo?.isFile()) {
    throw new Error(`File does not exist or is not a regular file: ${absoluteFile}`);
  }
  if (fileInfo.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds the 100MB upload limit: ${absoluteFile}`);
  }
  const filename = basename(absoluteFile);
  const mimeType = normalizeMimeType(options.mimeType) ?? inferMimeType(filename);
  const referenceDuration = options.videoReference ? await prepareVideoReferenceDuration(
    absoluteFile,
    fileInfo.size,
    mimeType,
    dependencies.readIsoBmffDurationSeconds ?? readIsoBmffDurationSeconds
  ) : void 0;
  const config = dependencies.loadConfig();
  const provider = dependencies.createAuthProvider(config);
  const tools = await dependencies.listConnectedConnectorTools(config, provider);
  const tool = findConnectorTool(tools, UPLOAD_TEMP_URL_TOOL_NAME);
  const response = await dependencies.callConnectorTool(config, provider, {
    provider: tool.provider,
    provider_tool_name: tool.provider_tool_name,
    runtime_tool_name: tool.runtime_tool_name,
    arguments_json: JSON.stringify({ filename, mime_type: mimeType })
  });
  if (response.is_error === true) throw connectorToolError(response);
  const signed = parseSignedUpload(response);
  if (fileInfo.size > signed.maxBytes) {
    throw new Error(
      `File exceeds the signed upload limit of ${signed.maxBytes} bytes: ${absoluteFile}`
    );
  }
  const bytes = await dependencies.readFileBytes(absoluteFile);
  const form = new FormData();
  for (const [key, value] of Object.entries(signed.fields)) form.append(key, value);
  form.append(
    signed.fileFieldName,
    new Blob([bytes], { type: mimeType }),
    filename
  );
  let uploadResponse;
  try {
    uploadResponse = await dependencies.upload(signed.uploadHost, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Temporary file upload failed: ${detail}`);
  }
  if (!uploadResponse.ok) {
    throw new Error(`Temporary file upload failed: HTTP ${uploadResponse.status}.`);
  }
  dependencies.print({
    file: absoluteFile,
    filename,
    bytes: fileInfo.size,
    mime_type: mimeType,
    temp_url: signed.tempUrl,
    expires_in_seconds: signed.expiresInSeconds,
    ...referenceDuration ? {
      probed_duration_seconds: referenceDuration.probedDurationSeconds,
      reference_video: {
        url: signed.tempUrl,
        duration_seconds: referenceDuration.matrixDurationSeconds
      }
    } : {}
  });
}
async function prepareVideoReferenceDuration(absoluteFile, bytes, mimeType, probeDuration) {
  const extension = extname(absoluteFile).toLowerCase();
  const expectedMimeType = extension === ".mp4" ? "video/mp4" : extension === ".mov" ? "video/quicktime" : void 0;
  if (!expectedMimeType) {
    throw new Error("--video-reference requires an .mp4 or .mov file.");
  }
  if (mimeType.toLowerCase() !== expectedMimeType) {
    throw new Error(
      `--video-reference MIME type for ${extension} must be ${expectedMimeType}; received ${mimeType}.`
    );
  }
  if (bytes > MAX_VIDEO_REFERENCE_BYTES) {
    throw new Error(`Reference video exceeds the 50MB upload limit: ${absoluteFile}`);
  }
  let probedDurationSeconds;
  try {
    probedDurationSeconds = await probeDuration(absoluteFile);
  } catch {
  }
  if (probedDurationSeconds === void 0 || !Number.isFinite(probedDurationSeconds)) {
    throw new Error(`Could not read reference video duration_seconds: ${absoluteFile}`);
  }
  if (probedDurationSeconds < 2 || probedDurationSeconds > 15) {
    throw new Error(
      `Reference video duration_seconds must be between 2 and 15; received ${probedDurationSeconds}.`
    );
  }
  return {
    probedDurationSeconds,
    matrixDurationSeconds: Math.ceil(probedDurationSeconds)
  };
}
function parseSignedUpload(response) {
  if (!response.result_json?.trim()) {
    throw new Error("Invalid upload_temp_url response: result_json is missing.");
  }
  let result;
  try {
    result = JSON.parse(response.result_json);
  } catch {
    throw new Error("Invalid upload_temp_url response: result_json must be valid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid upload_temp_url response: expected a JSON object.");
  }
  const value = result;
  if (value.code !== void 0 && normalizeCode2(value.code) !== 0) {
    const message = stringValue(value.message) ?? "request failed";
    throw new Error(`upload_temp_url failed: ${message} (code=${String(value.code)}).`);
  }
  const uploadHost = requiredHttpUrl(value.upload_host, "upload_host");
  const tempUrl = requiredHttpUrl(value.temp_url, "temp_url");
  if (new URL(uploadHost).protocol !== "https:") {
    throw new Error("Invalid upload_temp_url response: upload_host must use HTTPS.");
  }
  return {
    uploadHost,
    fields: stringRecord(value.fields, "fields"),
    fileFieldName: stringValue(value.file_field_name) ?? "file",
    tempUrl,
    maxBytes: positiveNumber(value.max_bytes, "max_bytes"),
    expiresInSeconds: positiveNumber(
      value.expires_in_seconds,
      "expires_in_seconds"
    )
  };
}
function normalizeMimeType(value) {
  if (value === void 0) return void 0;
  const normalized = value.trim();
  if (!normalized || !/^[\w.+-]+\/[\w.+-]+$/.test(normalized)) {
    throw new Error("--mime-type must be a valid media type such as image/png.");
  }
  return normalized;
}
function inferMimeType(filename) {
  const mimeTypes = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".m4a": "audio/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp"
  };
  return mimeTypes[extname(filename).toLowerCase()] ?? "application/octet-stream";
}
function requiredHttpUrl(value, field) {
  const normalized = stringValue(value);
  if (!normalized) {
    throw new Error(`Invalid upload_temp_url response: ${field} is missing.`);
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`Invalid upload_temp_url response: ${field} must be a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `Invalid upload_temp_url response: ${field} must use HTTP or HTTPS.`
    );
  }
  return normalized;
}
function stringRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid upload_temp_url response: ${field} must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.some(([, item]) => typeof item !== "string")) {
    throw new Error(
      `Invalid upload_temp_url response: ${field} must contain string values.`
    );
  }
  return Object.fromEntries(entries);
}
function positiveNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Invalid upload_temp_url response: ${field} must be a positive number.`
    );
  }
  return value;
}
function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function normalizeCode2(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return void 0;
}

// src/program.ts
function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
function handleError(error) {
  return fail(error instanceof Error ? error.message : String(error));
}
function createProgram(options) {
  const program3 = new Command();
  const activeProviders = /* @__PURE__ */ new Set();
  const createTrackedAuthProvider = (config) => {
    const provider = options.createAuthProvider(config);
    activeProviders.add(provider);
    return provider;
  };
  const authStatusDependencies = createManagedAuthStatusDependencies(
    createTrackedAuthProvider
  );
  const getAssetUrlDependencies = createGetAssetUrlDependencies(
    createTrackedAuthProvider
  );
  const uploadTempUrlDependencies = createUploadTempUrlDependencies(
    createTrackedAuthProvider
  );
  const connectorToolsDependencies = createConnectorToolsDependencies(
    createTrackedAuthProvider
  );
  const connectorToolDependencies = createConnectorToolDependencies(
    createTrackedAuthProvider
  );
  const connectorCallDependencies = createConnectorCallDependencies(
    createTrackedAuthProvider
  );
  async function runCommand(action) {
    let commandError;
    try {
      await action();
    } catch (error) {
      commandError = error;
    }
    const providers = [...activeProviders];
    activeProviders.clear();
    try {
      for (const provider of providers) await provider.dispose?.();
    } catch (error) {
      commandError ??= error;
    }
    if (commandError !== void 0) handleError(commandError);
  }
  program3.name("alran-tools").description(
    options.surface === "embedded" ? "alran-tools CLI \u2014 host-managed Connector tools" : "alran-tools CLI \u2014 OAuth login and connected Connector tools"
  ).version(PACKAGE_VERSION, "-v, --version", "output the current version");
  const auth = program3.command("auth").description(
    options.surface === "embedded" ? "Inspect host-managed authentication" : "Inspect and manage CLI authentication"
  );
  if (options.surface === "embedded") {
    auth.command("status").description("Print managed authentication status without exposing tokens").option("--json", "emit one JSON status event (default behavior)").action(async () => {
      await runCommand(() => managedAuthStatusCommand(authStatusDependencies));
    });
  }
  program3.command("get-asset-url").alias("get_asset_url").description("Get a short-lived URL for a Drive node").argument("<node_id>", "Drive node id").action(async (nodeId) => {
    await runCommand(() => getAssetUrlCommand(nodeId, getAssetUrlDependencies));
  });
  program3.command("upload-temp-url").alias("upload_temp_url").description("Upload one local file and return a temporary public URL").argument("<file_path>", "local file path").option("--mime-type <type>", "override the inferred media type").option(
    "--video-reference",
    "validate an H3 MP4/MOV reference and return Matrix-ready metadata"
  ).action(
    async (file, uploadOptions) => {
      await runCommand(
        () => uploadTempUrlCommand(
          file,
          uploadOptions,
          uploadTempUrlDependencies
        )
      );
    }
  );
  const connector = program3.command("connector").description("List and call connected Connector tools").addHelpText(
    "after",
    `
Examples:
  $ alran-tools connector tools
  $ alran-tools connector tools --keyword <text>
  $ alran-tools connector tool <tool_name>
  $ alran-tools connector call <tool_name> --args '<json-object>'
`
  );
  connector.command("tools").description("List connected tool names and descriptions as JSON").option("-k, --keyword <text>", "filter by tool name or description").action(async (connectorOptions) => {
    await runCommand(
      () => connectorToolsCommand(
        connectorOptions,
        connectorToolsDependencies
      )
    );
  });
  connector.command("tool").description(
    "Show one connected tool's name, description, and schemas as JSON"
  ).argument("<tool_name>", "tool_name returned by connector tools").action(async (toolName) => {
    await runCommand(
      () => connectorToolCommand(toolName, connectorToolDependencies)
    );
  });
  connector.command("call").description("Call a connected Connector tool and print its business result").argument("<tool_name>", "tool_name returned by connector tools").option("--args <json>", "tool arguments as a JSON object").option("--args-file <path>", "read tool arguments from a file, or - for stdin").option("--raw", "print the raw Connector response envelope").addHelpText(
    "after",
    `
By default, stdout is the tool business result described by output_schema.
JSON and plain text results are printed as returned. Use --raw for the complete
Connector response envelope.
`
  ).action(
    async (toolName, connectorOptions) => {
      await runCommand(
        () => connectorCallCommand(
          toolName,
          connectorOptions,
          connectorCallDependencies
        )
      );
    }
  );
  return program3;
}

// src/embedded-cli.ts
var program2 = createProgram({
  surface: "embedded",
  createAuthProvider: createEmbeddedAuthProvider
});
program2.parseAsync(process.argv).catch(handleError);
