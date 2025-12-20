# Contributing to CNC GCode Viewer

Thank you for your interest in contributing to CNC GCode Viewer! This document provides guidelines and instructions for contributing to the project.

## 🎯 Project Goals

- **Lightweight**: Keep total size under 135KB uncompressed, ~45KB gzipped
- **Zero Dependencies**: Pure vanilla JavaScript, no frameworks or libraries
- **Embedded-Friendly**: Must run on devices with limited storage and memory
- **Offline-First**: No external resources, no tracking, no data transmission
- **Accessible**: Clear code, good documentation, easy to understand

## 📋 Code of Conduct

- Be respectful and constructive
- Welcome newcomers and help them learn
- Focus on what is best for the community
- Show empathy towards other community members

## 🚀 Getting Started

### 1. Fork and Clone
```bash
# Fork the repository on GitHub
git clone https://github.com/jeyeager65/cnc-gcode-viewer.git
cd cnc-gcode-viewer
```

### 2. Create a Branch
```bash
# Create your feature branch from dev
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 3. Make Changes
- Edit files in the `src/` directory
- Test your changes in multiple browsers
- Ensure code follows project style guidelines

### 4. Test Thoroughly
- Test with sample GCode files in both 2D and 3D modes
- Test light and dark themes
- Test on mobile/tablet if possible
- Check browser console for errors

### 5. Commit
```bash
git add .
git commit -m "feat: add new feature"
# or
git commit -m "fix: resolve issue with..."
```

### 6. Push and Pull Request
```bash
git push origin feature/your-feature-name
```
Then create a Pull Request on GitHub.

## 📝 Commit Message Format

We use **Conventional Commits** format:

```
<type>: <description>

[optional body]

[optional footer]
```

### Types:
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, etc.)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Build process, dependencies, etc.

### Examples:
```
feat: add support for G28 homing command

fix: correct arc tessellation for small radii

docs: update deployment instructions for ESP32

perf: optimize 2D rendering for large files
```

## 💻 Code Style Guidelines

### JavaScript

#### General Principles
- **ES6+ syntax**: Use modern JavaScript features
- **No dependencies**: Pure vanilla JS only
- **Clear naming**: Use descriptive variable and function names
- **Comments**: Explain complex logic, not obvious code

#### Style Rules
```javascript
// Use const/let, never var
const segments = [];
let currentIndex = 0;

// Clear function names with JSDoc
/**
 * Parse single line of GCode
 * @param {string} line - Line to parse
 * @param {number} lineNum - Line number
 */
parseLine(line, lineNum) {
    // Implementation
}

// Prefer template literals
const message = `Processing line ${lineNum} of ${total}`;

// Use arrow functions for callbacks
segments.forEach(seg => {
    this.renderSegment(seg);
});

// Consistent indentation (4 spaces)
if (condition) {
    doSomething();
} else {
    doSomethingElse();
}
```

### HTML/CSS

#### HTML
- Semantic HTML5 elements
- Accessible markup (ARIA labels where needed)
- Keep structure clean and organized

#### CSS
- Use CSS custom properties for theming
- Mobile-first responsive design
- Avoid unnecessary specificity
- Keep selectors simple

```css
/* Use custom properties */
:root[data-theme="light"] {
    --bg-color: #ffffff;
    --text-color: #333333;
}

/* Clear, simple selectors */
.panel {
    background-color: var(--bg-color);
}

/* Mobile-first */
.container {
    grid-template-columns: 1fr;
}

@media (min-width: 768px) {
    .container {
        grid-template-columns: 1fr 300px;
    }
}
```

## 🔍 Code Review Checklist

Before submitting a PR, verify:

### Functionality
- [ ] Feature works as intended
- [ ] No console errors or warnings
- [ ] Tested in Chrome, Firefox, and Safari
- [ ] Tested in both 2D and 3D modes
- [ ] Tested with sample GCode files
- [ ] Touch controls work (if applicable)

### Code Quality
- [ ] Follows project code style
- [ ] No unnecessary complexity
- [ ] Comments explain "why", not "what"
- [ ] No hardcoded values (use constants)
- [ ] Error handling is appropriate

### Performance
- [ ] No memory leaks
- [ ] Efficient algorithms used
- [ ] Doesn't slow down rendering
- [ ] File size budget maintained

### Documentation
- [ ] README updated if needed
- [ ] Code comments added for complex logic
- [ ] JSDoc for public functions
- [ ] CONTRIBUTING.md updated if process changed

## 📏 File Size Budget

**Critical**: Total uncompressed size must stay under **135KB**

Current allocations (standalone version):
- `index.html`: ~30KB (including inlined CSS)
- `parser.js`: ~20KB
- `camera.js`: ~10KB
- `renderer2d.js`: ~20KB
- `renderer3d.js`: ~30KB
- `animator.js`: ~8KB
- `controller.js`: ~15KB

**FluidNC version** adds:
- `fluidnc-api.js`: ~8KB
- `fluidnc-controller.js`: ~12KB
- `fluidnc.css`: ~3KB

**Total**: ~133KB standalone, ~156KB FluidNC (budget applies to standalone)

Before adding features that increase size:
1. Check if existing code can be optimized
2. Consider if feature is essential
3. Discuss in issue before implementing

## 🧪 Testing

### Manual Testing Checklist

#### File Loading
- [ ] Drag and drop works
- [ ] File browser works
- [ ] Progress bar displays correctly
- [ ] Large files (2-5MB) load without freezing

#### 2D Rendering
- [ ] Grid displays correctly
- [ ] Pan with mouse works
- [ ] Zoom with wheel works
- [ ] Zoom centers on mouse position
- [ ] Double-click resets view
- [ ] Coordinate display updates on hover

#### 3D Rendering
- [ ] Model renders correctly
- [ ] Rotation with drag works
- [ ] Pan with Shift+drag works
- [ ] Zoom with wheel works
- [ ] Depth testing works (no z-fighting)
- [ ] Axes display correctly

#### Animation
- [ ] Play/pause works
- [ ] Reset works
- [ ] Next/previous line works
- [ ] Speed slider works
- [ ] Progress bar updates
- [ ] Line counter updates

#### Themes
- [ ] Light theme displays correctly
- [ ] Dark theme displays correctly
- [ ] Theme persists after refresh
- [ ] Toggle button updates

#### Layer Filter
- [ ] Min Z filter works
- [ ] Max Z filter works
- [ ] Combined filters work
- [ ] Clear filters works

#### Screenshot
- [ ] 2D screenshot exports correctly
- [ ] 3D screenshot exports correctly
- [ ] Filename is descriptive

### Browser Testing
Test in:
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest, if on Mac)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

## 🐛 Bug Reports

Good bug reports include:

1. **Clear title**: Describe the issue concisely
2. **Steps to reproduce**: Exact steps to trigger the bug
3. **Expected behavior**: What should happen
4. **Actual behavior**: What actually happens
5. **Environment**: Browser, OS, file size, etc.
6. **Screenshots**: If applicable
7. **Console errors**: Check browser console

### Example Bug Report
```markdown
## Arc rendering incorrect for small circles

**Steps to Reproduce:**
1. Load GCode with G2 arc, radius < 1mm
2. Zoom in to 10x
3. Observe jagged appearance

**Expected:** Smooth circular arc
**Actual:** Polygon with ~8 sides

**Environment:**
- Browser: Chrome 120
- OS: Windows 11
- File: circle_test.nc (attached)

**Console Errors:** None

**Screenshot:** [attached]
```

## 💡 Feature Requests

When proposing new features:

1. **Check existing issues**: May already be discussed
2. **Explain use case**: Why is this needed?
3. **Consider alternatives**: Are there other solutions?
4. **Estimate impact**: File size, complexity, etc.
5. **Provide examples**: Mock-ups, code samples, etc.

### Feature Request Template
```markdown
## Feature: [Name]

**Problem:** 
Describe the problem this solves.

**Proposed Solution:**
Describe your proposed implementation.

**Alternatives Considered:**
What other approaches did you consider?

**Impact:**
- File size: +X KB
- Complexity: Low/Medium/High
- Breaking changes: Yes/No

**Examples:**
[Code samples, screenshots, etc.]
```

## 🏗️ Development Workflow

### For Small Changes
1. Fork and create branch
2. Make changes
3. Test locally
4. Submit PR

### For Large Changes
1. Open issue first for discussion
2. Get feedback on approach
3. Fork and create branch
4. Implement in small commits
5. Test thoroughly
6. Submit PR with issue reference

## 📦 Release Process

Releases are automated via GitHub Actions:

1. Maintainer merges approved PRs
2. Maintainer creates and pushes version tag:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. GitHub Actions automatically:
   - Minifies code
   - Creates single-file HTML
   - Gzips files
   - Generates changelog
   - Creates release
   - Deploys to GitHub Pages

## 🎓 Learning Resources

### JavaScript/WebGL
- [MDN Web Docs](https://developer.mozilla.org/)
- [WebGL Fundamentals](https://webglfundamentals.org/)
- [Canvas 2D API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

### GCode
- [LinuxCNC G-Code Reference](http://linuxcnc.org/docs/html/gcode.html)
- [GRBL Documentation](https://github.com/gnea/grbl/wiki)
- [FluidNC Documentation](https://github.com/bdring/FluidNC)

## 🤝 Questions?

- **General questions**: [GitHub Discussions](https://github.com/jeyeager65/cnc-gcode-tools/discussions)
- **Bug reports**: [GitHub Issues](https://github.com/jeyeager65/cnc-gcode-tools/issues)
- **Feature requests**: [GitHub Issues](https://github.com/jeyeager65/cnc-gcode-tools/issues)

## 🙏 Thank You!

Every contribution, no matter how small, is valuable. Thank you for helping make CNC GCode Viewer better!
