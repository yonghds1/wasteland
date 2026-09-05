#!/usr/bin/env bash
# wasteland command completion for bash

_wasteland_completions() {
    local cur prev commands subcommands
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    # Main commands
    commands="chat config current init tui sessions resume skin export logs context rename auto-rename help"

    # Subcommands for each command
    declare -A subcommands
    subcommands[config]="current"
    subcommands[sessions]="show delete stats switch rename tag untag cleanup"
    subcommands[logs]="errors show tail"
    subcommands[context]="history compaction trend"
    subcommands[skin]="list show load info"

    # If we're at the first argument (command level)
    if [ $COMP_CWORD -eq 1 ]; then
        COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        return 0
    fi

    # Get the main command
    local cmd="${COMP_WORDS[1]}"

    # If we're at the second argument and there are subcommands
    if [ $COMP_CWORD -eq 2 ] && [ -n "${subcommands[$cmd]}" ]; then
        COMPREPLY=( $(compgen -W "${subcommands[$cmd]}" -- "$cur") )
        return 0
    fi

    # Context-specific completions
    case "$cmd" in
        sessions)
            # Complete session IDs for switch/rename/tag/untag
            if [ "$prev" = "switch" ] || [ "$prev" = "rename" ] || [ "$prev" = "tag" ] || [ "$prev" = "untag" ]; then
                local sessions=$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
                COMPREPLY=( $(compgen -W "$sessions" -- "$cur") )
            fi
            ;;
        context)
            # Complete session IDs for history/compaction/trend
            if [ "$prev" = "history" ] || [ "$prev" = "compaction" ] || [ "$prev" = "trend" ]; then
                local sessions=$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
                COMPREPLY=( $(compgen -W "$sessions" -- "$cur") )
            fi
            ;;
        rename)
            # Complete session IDs for rename command
            if [ $COMP_CWORD -eq 2 ]; then
                local sessions=$(wasteland sessions --json 2>/dev/null | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
                COMPREPLY=( $(compgen -W "$sessions" -- "$cur") )
            fi
            ;;
    esac

    return 0
}

complete -F _wasteland_completions wasteland
