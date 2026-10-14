export interface LangSpec {
  id: string;
  label: string;
  ext: string;
  starter: string;
  run?: {
    image: string;
    /** Build the container command for an entry file at /work/<path>. */
    cmd: (file: string) => string[];
    env?: Record<string, string>;
  };
}

const sh = (script: string) => (file: string) => ['sh', '-c', script, file];

export const LANGUAGES: LangSpec[] = [
  {
    id: 'javascript', label: 'JavaScript', ext: 'js',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
function sum(numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}

console.log("Hello from CodeSync");
console.log("sum:", sum([1, 2, 3]));
`,
    run: { image: 'node:20-alpine', cmd: (f) => ['node', f] },
  },
  {
    id: 'typescript', label: 'TypeScript', ext: 'ts',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
function sum(numbers: number[]): number {
  return numbers.reduce((total, n) => total + n, 0);
}

console.log("Hello from CodeSync");
console.log("sum:", sum([1, 2, 3]));
`,
    run: { image: 'node:22-alpine', cmd: (f) => ['node', '--experimental-strip-types', '--disable-warning=ExperimentalWarning', f] },
  },
  {
    id: 'python', label: 'Python', ext: 'py',
    starter: `# Welcome to CodeSync. Edit together, then press Run.
def total(numbers):
    return sum(numbers)

print("Hello from CodeSync")
print("sum:", total([1, 2, 3]))
`,
    run: { image: 'python:3.12-alpine', cmd: (f) => ['python', '-u', f], env: { PYTHONDONTWRITEBYTECODE: '1' } },
  },
  {
    id: 'java', label: 'Java', ext: 'java',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
public class Main {
    static int sum(int[] numbers) {
        int total = 0;
        for (int n : numbers) total += n;
        return total;
    }

    public static void main(String[] args) {
        System.out.println("Hello from CodeSync");
        System.out.println("sum: " + sum(new int[] {1, 2, 3}));
    }
}
`,
    run: { image: 'eclipse-temurin:21-jdk-alpine', cmd: (f) => ['java', '-Xmx128m', '-XX:+UseSerialGC', f] },
  },
  {
    id: 'cpp', label: 'C++', ext: 'cpp',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
#include <iostream>
#include <numeric>
#include <vector>

int main() {
    std::vector<int> numbers = {1, 2, 3};
    std::cout << "Hello from CodeSync" << std::endl;
    std::cout << "sum: " << std::accumulate(numbers.begin(), numbers.end(), 0) << std::endl;
    return 0;
}
`,
    run: { image: 'gcc:13', cmd: sh('g++ -std=c++17 -O1 -o /tmp/a.out "$0" && /tmp/a.out') },
  },
  {
    id: 'c', label: 'C', ext: 'c',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
#include <stdio.h>

int main(void) {
    int numbers[] = {1, 2, 3};
    int total = 0;
    for (int i = 0; i < 3; i++) total += numbers[i];
    printf("Hello from CodeSync\\n");
    printf("sum: %d\\n", total);
    return 0;
}
`,
    run: { image: 'gcc:13', cmd: sh('gcc -O1 -o /tmp/a.out "$0" -lm && /tmp/a.out') },
  },
  {
    id: 'go', label: 'Go', ext: 'go',
    starter: `// Welcome to CodeSync. Edit together, then press Run.
package main

import "fmt"

func sum(numbers []int) int {
	total := 0
	for _, n := range numbers {
		total += n
	}
	return total
}

func main() {
	fmt.Println("Hello from CodeSync")
	fmt.Println("sum:", sum([]int{1, 2, 3}))
}
`,
    run: {
      image: 'golang:1.22-alpine',
      cmd: (f) => ['go', 'run', f],
      env: { GOCACHE: '/tmp/gocache', GOPATH: '/tmp/gopath', GOFLAGS: '-buildvcs=false', CGO_ENABLED: '0' },
    },
  },
  {
    id: 'ruby', label: 'Ruby', ext: 'rb',
    starter: `# Welcome to CodeSync. Edit together, then press Run.
def total(numbers)
  numbers.sum
end

puts "Hello from CodeSync"
puts "sum: #{total([1, 2, 3])}"
`,
    run: { image: 'ruby:3.3-alpine', cmd: (f) => ['ruby', f] },
  },
  // Editable, not runnable
  { id: 'rust', label: 'Rust', ext: 'rs', starter: 'fn main() {\n    println!("Hello from CodeSync");\n}\n' },
  { id: 'php', label: 'PHP', ext: 'php', starter: '<?php\n\necho "Hello from CodeSync";\n' },
  { id: 'sql', label: 'SQL', ext: 'sql', starter: '-- Notes and queries\nSELECT 1;\n' },
  { id: 'shell', label: 'Shell', ext: 'sh', starter: '#!/bin/sh\necho "Hello from CodeSync"\n' },
  { id: 'html', label: 'HTML', ext: 'html', starter: '<!doctype html>\n<html>\n  <body>\n    <h1>Hello from CodeSync</h1>\n  </body>\n</html>\n' },
  { id: 'css', label: 'CSS', ext: 'css', starter: 'body {\n  font-family: system-ui, sans-serif;\n}\n' },
  { id: 'json', label: 'JSON', ext: 'json', starter: '{\n  "name": "codesync"\n}\n' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', starter: 'name: codesync\n' },
  { id: 'markdown', label: 'Markdown', ext: 'md', starter: '# Notes\n\nWrite findings here.\n' },
  { id: 'plaintext', label: 'Plain text', ext: 'txt', starter: '' },
];

export const LANG_BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
const EXT_TO_LANG = new Map<string, string>([
  ['mjs', 'javascript'], ['cjs', 'javascript'], ['jsx', 'javascript'], ['tsx', 'typescript'],
  ['cc', 'cpp'], ['cxx', 'cpp'], ['h', 'c'], ['hpp', 'cpp'], ['yml', 'yaml'], ['bash', 'shell'],
  ...LANGUAGES.map((l) => [l.ext, l.id] as [string, string]),
]);

export function languageFromName(name: string): string | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_TO_LANG.get(ext) ?? null;
}
export const isKnownLanguage = (id: string) => LANG_BY_ID.has(id);
