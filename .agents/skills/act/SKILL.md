```markdown
# act Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `act` JavaScript codebase. You'll learn about file naming, import/export styles, commit message conventions, and how to write and run tests. This guide is designed to help contributors quickly get up to speed and maintain consistency throughout the project.

## Coding Conventions

### File Naming
- Use **camelCase** for all filenames.
  - Example: `myModule.js`, `userActions.js`

### Import Style
- Use **relative imports** for modules.
  - Example:
    ```javascript
    import { doSomething } from './utils';
    ```

### Export Style
- Use **named exports**.
  - Example:
    ```javascript
    // utils.js
    export function doSomething() { ... }
    export const CONSTANT = 42;
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
  - Example:
    ```
    feat: add user authentication middleware
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or module  
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Implement your feature using named exports.
3. Import any dependencies using relative paths.
4. Write corresponding tests in a `.test.js` file.
5. Commit your changes using the conventional commit format with the `feat` prefix.
   - Example: `feat: implement user login functionality`

### Writing and Running Tests
**Trigger:** When adding or updating code  
**Command:** `/run-tests`

1. Create a test file with the pattern `*.test.js` in the relevant directory.
2. Write tests for your functions or modules.
3. Use the project's preferred test runner (framework not specified; check project documentation or package.json).
4. Run the tests to ensure everything passes.

## Testing Patterns

- Test files follow the `*.test.js` naming convention.
- Place tests alongside the modules they cover or in a dedicated `tests` directory.
- The specific testing framework is not specified; look for clues in the project or ask a maintainer.
- Example test file:
  ```javascript
  // utils.test.js
  import { doSomething } from './utils';

  test('doSomething returns expected value', () => {
    expect(doSomething()).toBe(true);
  });
  ```

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /add-feature   | Guide for adding a new feature/module        |
| /run-tests     | Instructions for writing and running tests   |
```
