---
name: zog-best-practices
description: Guides correct use of Zog, a Zod-inspired Go schema validation and parsing library with chainable schemas. Use when writing, reviewing, or debugging Go code that imports github.com/Oudwins/zog or mentions Zog schemas, Parse, Validate, zhttp, zjson, zenv, preprocessors, or Zog errors.
---

# Zog Usage

Use this skill when writing, reviewing, or debugging Go code that uses `github.com/Oudwins/zog`.

## 1. What Is Zog

Zog is a Zod-inspired schema validation and parsing library for Go. The API is chainable and schema-first: define a schema, then either parse external input into a destination or validate an already-built Go value.

Zog is useful for HTTP handlers, JSON input, environment variables, config, forms, and any place where Go values need validation plus optional coercion.

## 2. Defining A Schema

Define reusable schemas with `z.Struct(z.Shape{...})` and primitive schema builders like `z.String()`, `z.Int()`, `z.Bool()`, `z.Time()`, `z.Slice(...)`, and `z.Ptr(...)`.

```go
import z "github.com/Oudwins/zog"

type User struct {
	Name string `json:"name" zog:"name"`
	Age  int    `json:"age" zog:"age"`
}

var userSchema = z.Struct(z.Shape{
	"Name": z.String().Required().Min(3),
	"Age":  z.Int().Required().GT(18),
})
```

Schema keys for structs are Go field names. Tags such as `json`, `zog`, or `env` map external input keys to those fields during parsing.

```go
type User struct {
	Name string `json:"name" zog:"name"`
}

var userSchema = z.Struct(z.Shape{
	"Name": z.String().Required(), // Go field name, not "name"
})
```

## 3. Validating And Parsing

Use `Parse(data, &dest)` when input is external or loosely typed. `Parse` can coerce values and writes into the destination.

```go
var user User
errs := userSchema.Parse(map[string]any{"name": "Ada", "age": "42"}, &user)
if errs != nil {
	return errs
}
```

Use `Validate(&value)` when the value is already a typed Go value and you only need validation.

```go
user := User{Name: "Ada", Age: 42}
errs := userSchema.Validate(&user)
if errs != nil {
	return errs
}
```

Zog returns `z.ZogIssueList`; `nil` means success. If relevant to the task, fetch https://zog.dev/errors/overview.md for error concepts, or https://zog.dev/errors/formatting.md for helpers like `z.Issues.Flatten`, `z.Issues.Treeify`, `z.Issues.Prettify`, and custom response formatting.

## 4. Supporting Packages

- `zhttp`: parse `http.Request` JSON, form, multipart-after-manual-parse, or query input.
- `zjson`: parse JSON readers into structs.
- `zenv`: parse environment variables into typed config structs.
- `i18n`: configure localized error messages.
- `zconst`: constants for issue codes, types, and tags.

## 5. Common Mistakes

### Mistake: Using JSON Names As Struct Schema Keys

Wrong:

```go
var schema = z.Struct(z.Shape{
	"name": z.String().Required(),
})
```

Correct:

```go
type User struct {
	Name string `json:"name" zog:"name"`
}

var schema = z.Struct(z.Shape{
	"Name": z.String().Required(),
})
```

### Mistake: Forgetting That Fields Are Optional By Default

Wrong:

```go
var schema = z.Struct(z.Shape{
	"Email": z.String().Email(), // missing input is allowed
})
```

Correct:

```go
var schema = z.Struct(z.Shape{
	"Email": z.String().Required().Email(),
})
```

### Mistake: Passing Non-Pointers To Execution Methods

Wrong:

```go
var user User
errs := userSchema.Parse(data, user)
errs := userSchema.Validate(user)
```

Correct:

```go
var user User
errs := userSchema.Parse(data, &user)
errs := userSchema.Validate(&user)
```

### Mistake: Treating Parse And Validate As Interchangeable

Wrong:

```go
// Validating an already-zero-valued struct cannot prove an absent field was present.
var user User
errs := userSchema.Validate(&user)
```

Correct:

```go
// Use Parse for external input when presence and coercion matter.
var user User
errs := userSchema.Parse(input, &user)
```

### Mistake: Blind Type Assertions In Preprocessors

Wrong:

```go
schema := z.Preprocess(func(data any, ctx z.Ctx) (any, error) {
	return strings.Split(data.(string), ","), nil
}, z.Slice(z.String()))
```

Correct:

```go
schema := z.Preprocess(func(data any, ctx z.Ctx) (any, error) {
	s, ok := data.(string)
	if !ok {
		return nil, fmt.Errorf("expected string but got %T", data)
	}
	return strings.Split(s, ","), nil
}, z.Slice(z.String()))
```

## 6. Best Practices

### Reuse Schemas Instead Of Rebuilding Them

Prefer global or package-level schemas for hot paths such as HTTP requests.

```go
var createUserSchema = z.Struct(z.Shape{
	"Name": z.String().Required().Min(3),
	"Age":  z.Int().Required().GT(18),
})

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var user User
	errs := createUserSchema.Parse(zhttp.Request(r), &user)
	_ = errs
}
```

If a schema must be built dynamically and performance matters, consider `sync.Pool` to reuse schemas.

### Prefer Validate When Coercion Is Not Needed

`Validate` is faster than `Parse` when you already have a typed Go value.

```go
func saveUser(user *User) error {
	if errs := userSchema.Validate(user); errs != nil {
		return fmt.Errorf("invalid user: %v", z.Issues.Flatten(errs))
	}
	return nil
}
```

### Collect Issues After Using Them On Hot Paths

Issue generation is allocation-heavy. After formatting or logging issues, collect them for reuse.

```go
errs := userSchema.Validate(&user)
if errs != nil {
	defer z.Issues.Collect(errs)
	return z.Issues.Flatten(errs)
}
```


### Wrap Reusable Custom Tests

Use helper functions for repeated custom validation so messages and options stay consistent.

```go
func StrongPassword(opts ...z.TestOption) z.Test[*string] {
	return z.TestFunc("strong_password", func(password *string, ctx z.Ctx) bool {
		return len(*password) >= 12
	}, opts...)
}

var schema = z.Struct(z.Shape{
	"Password": z.String().Required().Test(StrongPassword()),
})
```

### Be Careful With Global Configuration

The `conf` package changes behavior globally for all schemas. Prefer local schema options unless the whole application needs the change.

```go
conf.Coercers.Float64 = func(data any) (any, error) {
	if str, ok := data.(string); ok && strings.Contains(str, ",") {
		return parseCommaFloat(str)
	}
	return conf.DefaultCoercers.Float64(data)
}
```

## References

- Full API Reference: https://zog.dev/reference.md
- Package docs:
- `zhttp`: https://zog.dev/packages/zhttp.md
- `zjson`: https://zog.dev/packages/zjson.md
- `zenv`: https://zog.dev/packages/zenv.md
- `i18n`: https://zog.dev/packages/i18n.md
- `zconst`: https://zog.dev/packages/zconst.md
- `internals`: https://zog.dev/packages/internals.md
- When fetched docs pages contain relative links, follow them as markdown by using `https://zog.dev/{relative_path}.md`.

## SOP

When using this skill, first understand the user's request and identify which Zog concepts or packages are involved. Fetch the reference or package docs above only when they are relevant or needed to avoid guessing. After gathering the necessary context, perform the user's request.
