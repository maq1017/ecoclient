/**
 * Reads a password from stdin without echoing characters to the terminal.
 * Falls back to plain readline if stdin is not a TTY.
 */
export const readHiddenPassword = (prompt: string): Promise<string> => {
  if (!process.stdin.isTTY) {
    // Non-interactive fallback: read a line without hiding
    return new Promise(resolve => {
      const chunks: Buffer[] = [];
      process.stdout.write(prompt);
      process.stdin.resume();
      process.stdin.once('data', chunk => {
        process.stdin.pause();
        resolve(chunk.toString().replace(/[\r\n]+$/, ''));
      });
    });
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const chars: string[] = [];

    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');

    const onData = (char: Buffer | string) => {
      const c = char.toString('utf8');
      switch (c) {
        case '\r':
        case '\n':
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(chars.join(''));
          break;
        case '\u0003': // Ctrl+C
          process.stdin.removeListener('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          reject(new Error('Interrupted'));
          break;
        case '\u007f': // DEL (backspace on most terminals)
        case '\b':     // BS
          chars.pop();
          break;
        default:
          if (c >= ' ') {
            chars.push(c);
          }
          break;
      }
    };

    process.stdin.on('data', onData);
  });
};
