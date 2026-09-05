#compdef wasteland

# wasteland command completion for zsh

_wasteland() {
    local -a commands

    # Main commands
    commands=(
        'chat:启动交互式聊天会话'
        'config:输出当前生效的运行时配置'
        'current:输出当前生效的运行时配置'
        'init:首次运行配置向导'
        'tui:启动交互式 TUI Dashboard'
        'sessions:列出本地 session'
        'resume:恢复之前的会话'
        'skin:皮肤管理'
        'export:将会话导出为 markdown'
        'logs:查看 wasteland 运行时日志'
        'context:查看当前 context 使用情况'
        'rename:重命名会话'
        'auto-rename:批量自动重命名未命名的会话'
        'help:显示帮助信息'
    )

    _arguments -C \
        '1:command:->command' \
        '*::arg:->args'

    case $state in
        command)
            _describe -t commands 'wasteland command' commands
            ;;
        args)
            local cmd=${words[1]}
            local subcmd=${words[2]}

            case $cmd in
                sessions)
                    local -a subs
                    case $subcmd in
                        switch|rename|tag|untag|show|delete)
                            local -a sessions
                            sessions=(${(f)"$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)"})
                            _describe -t sessions 'session id' sessions
                            ;;
                        *)
                            subs=(
                                'show:查看session详情'
                                'delete:删除session'
                                'stats:显示session统计信息'
                                'switch:切换到指定会话'
                                'rename:重命名会话'
                                'tag:为会话添加标签'
                                'untag:从会话移除标签'
                                'cleanup:清理过期会话'
                            )
                            _describe -t subcommands 'subcommand' subs
                            ;;
                    esac
                    ;;
                context)
                    local -a subs
                    case $subcmd in
                        history|compaction|trend)
                            local -a sessions
                            sessions=(${(f)"$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)"})
                            _describe -t sessions 'session id' sessions
                            ;;
                        *)
                            subs=(
                                'history:查看context使用历史'
                                'compaction:查看压缩历史'
                                'trend:查看使用趋势图'
                            )
                            _describe -t subcommands 'subcommand' subs
                            ;;
                    esac
                    ;;
                rename)
                    if [ $CURRENT -eq 2 ]; then
                        local -a sessions
                        sessions=(${(f)"$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)"})
                        _describe -t sessions 'session id' sessions
                    fi
                    ;;
                logs)
                    local -a subs
                    subs=(
                        'errors:查看error.jsonl最近条目'
                        'show:显示指定sessionId的所有runtime+error条目'
                        'tail:跟踪当前runtime日志文件'
                    )
                    _describe -t subcommands 'subcommand' subs
                    ;;
                skin)
                    local -a subs
                    subs=(
                        'list:列出所有可用皮肤'
                        'show:显示当前皮肤详情'
                        'load:加载指定皮肤'
                        'info:显示皮肤详情'
                    )
                    _describe -t subcommands 'subcommand' subs
                    ;;
                config)
                    local -a subs
                    subs=(
                        'current:输出当前生效的运行时配置'
                    )
                    _describe -t subcommands 'subcommand' subs
                    ;;
            esac
            ;;
    esac
}

_wasteland "$@"
