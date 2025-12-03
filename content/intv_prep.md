---
title: "V's Personal Interview Preparation Note"
description: "A little bit about everything that I have gained and has been useful so far"
hideHeader: true
hideBackToTop: true
hidePagination: true
readTime: true
---

Wow you found this page, welcome! It's either you;
- Typed the correct URL (if that's the case, congrats!)
- One of people that I trust and owe something to, so I hope this can help and paid a bit of something I owed

Here's my personal interview preparation note. It started as an old note that I wrote back in college as a fresh-graduate, found in an old hard drive. 

But I decided to improve the whole thing by fact-checking and adding some things that either actually get asked in the interview or things that I learned, gained and experienced during my ~4+ years of career thus far

_// TODO: Visualize several things with three.js just like [1000 boids](../posts/1000_boids) article?_

# Fundamentals and C++

## 1. Scope and lifetime

- **Scope**: Where the variable is _visible_ (where you can type its name and the compiler knows what it is)
- **Lifetime**: When the variable actually _exists_ in the memory


Usually these overlaps, _but not always_

Example of mismatch: If an object gets created on the _Heap_ via `new` keyword, the pointer variable _might go out of scope_ (you can't see it anymore), but the object itself has an infinite **lifetime**, until you explicitly _delete_ it. Typically this is called **a memory leak**

## 2. Automatic storage (stack scope)

Default behavior for variables declared inside functions or code blocks `{}`

Object is created when execution reaches the declaration. It is **automatically destroyed** when execution reaches the closing curly brace `}` of that block

```cpp {linenos=inline}
class Player {
public:
    Player() { std::cout << "Player Created\n"; }
    ~Player() { std::cout << "Player Destroyed\n"; }
};

void GameLoop() {
    std::cout << "Start Loop\n";
    
    // Scope 1: The Function Body
    Player p1; // Created here

    {
        // Scope 2: A nested block (e.g., inside an if statement)
        std::cout << "Entering Block\n";
        Player p2; // Created here
        std::cout << "Leaving Block\n";
    } // <--- p2 is DESTROYED here immediately. p1 is still alive.

    std::cout << "End Loop\n";
} // <--- p1 is DESTROYED here.
```

Understand that `p2` does not exist outside that small block. Typically we often use `{}` blocks to specifically force an object (like a temporary texture or mutex lock) to die early to free up resources


## 3. Static storage (`static` keyword)

### 3a. Static local variable

A variable inside a function that gets marked as `static` is initialized **only once**, the first time the code runs and it **retains its value** between function calls. Its lifetime is the entire program execution


```cpp {linenos=inline}
int GetNextID() {
    // This line runs ONLY the first time GetNextID is called
    static int counter = 0; 
    
    counter++;
    return counter;
}

// Usage:
// GetNextID() -> returns 1
// GetNextID() -> returns 2 (It remembers!)
```

### 3b. Static class member

A variable in a class marked `static` is shared **by all instances** of that class. It is not stored inside the object itself

```cpp {linenos=inline}
class Enemy {
public:
    static int EnemyCount; // Declaration
    Enemy() { EnemyCount++; }
    ~Enemy() { EnemyCount--; }
};

// Definition (must be done outside the class, usually in .cpp)
int Enemy::EnemyCount = 0; 

// If you spawn 50 Enemy objects, there is still only ONE "EnemyCount" variable in memory.
```

## 4. RAII (Resource Acquisition is Initialization)

Stupid name. But arguably one of the most important concept in modern C++. It relies entirely on Scope and Lifetime.

The concept: You _acquire a resource_ (open a file, allocate memory, lock a thread) in the **Constructor** and you _release it_ in the **Destructor**. C++ guarantees destructors run when a stack object goes out of scope, this subsequently prevents leaks.

**=== BAD CODE ===**
```cpp {linenos=inline}
void ProcessFile() {
    FILE* f = fopen("data.txt", "r"); // Acquire
    
    if (!f) return;
    
    // ... do work ...
    if (ErrorDetected) {
        return; // DANGER! We returned without closing 'f'. Resource leak!
    }

    fclose(f); // Release
}
```

**=== GOOD CODE ===**
```cpp {linenos=inline}
class FileHandler {
    FILE* f;
public:
    FileHandler(const char* name) { f = fopen(name, "r"); }
    ~FileHandler() { if(f) fclose(f); } // Destructor handles cleanup
};

void ProcessFile() {
    FileHandler myFile("data.txt"); 
    
    // ... do work ...
    if (ErrorDetected) {
        return; // SAFE. myFile goes out of scope, destructor runs, file closes.
    }
}
```

Typically this proves that you know how to write "exception safe" code. If the game crashes or throws an error, RAII ensures you don't leave any memory leaks behind

## 5. Member initialization order

Class members are initialized in the order they are **declared in the header file**, _NOT_ the order they appear in the constructor's initialization list. This is often the trap that catches me off-guard

**The trap:**
```cpp {linenos=inline}
class BadClass {
    int y;
    int x; // Declared SECOND
public:
    // Constructor attempts to init x first, then use x to init y.
    // Looks fine here...
    BadClass(int val) : x(val), y(x * 2) {} 
};
```

**The bug:**
- The compiler looks at the header
- `y` is declared first
- It initializes `y` first
- It tries to set `y = x * 2`
- **BUT `x` hasn't been initialized yet!** it contains garbage memory
- `y` becomes garbage value
- Then `x` is initialized

To fix, always keep initialization list in the same order as your variable declarations. Most compilers will actually warn you about this (`-Wreorder`)

## 6. Constructors and Destructors

### 6a. Lifecycle

- **Constructor (`MyClass()`)**: Called automatically when an object is created. It sets up the "invariant" (state required for the object to function)
- **Destructor (`~MyClass()`)**: Called automatically when an object is destroyed, either due to eithergoes out of scope or `delete` is explicitly called

It's a good idea to avoid heavy logic in Constructors. Why? C++ constructors cannot return error codes. Let's say if loading a texture fails inside a constructor, you have to throw an exception (which many game engines disable) or leave the object in an invalid "zombie" state

Safe pattern: Lightweight constructor + an `Init()` function that returns a `bool` for success/failure

## 6b. Virtual Destructor

Say you have a Base class `Enemy`, and a derived class `Boss`. You are holding a pointer to the **Base** class, but _it points_ to the **derived object**

**The trap:**
```cpp {linenos=inline}
class Enemy {
public:
    Enemy() { std::cout << "Enemy Created\n"; }
    // NON-VIRTUAL Destructor
    ~Enemy() { std::cout << "Enemy Destroyed\n"; } 
};

class Boss : public Enemy {
    int* heavyData;
public:
    Boss() { heavyData = new int[1000]; std::cout << "Boss Created\n"; }
    ~Boss() { 
        delete[] heavyData; // Cleanup
        std::cout << "Boss Destroyed\n"; 
    }
};

void KillEnemy() {
    // Polymorphism: Base pointer holding Derived object
    Enemy* e = new Boss(); 
    
    // ... game logic ...

    delete e; // <--- PROBLEM HERE
}
```

This essentially makes it so that if `~Enemy()` is **not** marked as `virtual`, the compiler only looks at the pointer of type `Enemy*`. It calls `~Enemy()`, but **it never calls `~Boss()`**. Thus, `heavyData` array in `Boss` never gets deleted, causing memory leak

**The fix:**
```cpp {linenos=inline}
class Enemy {
public:
    virtual ~Enemy() { std::cout << "Enemy Destroyed\n"; }
};
```

Simple enough. Now, `delete e` looks up the `vtable` and sees that the object is actually a `Boss`. Subsequently calls `~Boss()` first, followed by `~Enemy()`


### 6c. Initialization lists vs. Assignment

There are two ways to give values to member variables in a constructor. One is faster; the other is sometimes impossible

#### Option A: Assignment, inside the body
```cpp {linenos=inline}
class Player {
    std::string name;
public:
    Player(std::string n) {
        name = n; 
    }
};
```

- `name` is default constructed (empty string created)
- The assignment operator is called to copy `n` into `name`
- The temporary string is destroyed

**We're wasting CPU cycles creating an empty string, just to overwrite it immediately**

#### Option B: Initialization list, after the colon
```cpp {linenos=inline}
class Player {
    std::string name;
public:
    Player(std::string n) : name(n) { // <--- This is the list
        // Body is empty
    }
};
```

Now, `name` is **copy constructed** directly from `n`. More efficient since we no longer waste CPU cycle for creating empty string

It's almost always a good idea to use initialization lists for:
- `const` members, since they cannot be assigned to later
- Reference members (`int& ref`, etc.), since they must be bound upon creation
- Objects without default constructors. If a member class requires arguments to be built, you must pass them in the list


### 6d. The rule of three (and five lol)

This relates to how C++ handles copying objects. By default, C++ **does a shallow copy**, which just copies the bits

It creates a problem, if your class manages a raw pointer (i.e., to a texture or an array), a shallow copy _copies the address_, not the data itself

Hypotetically, it goes like this:
- Obj A is created. Allocates memory at address `0x123`
- Obj B is created as _a copy of A_. It _also points to `0x123`_
- Obj A is destroyed, deletes `0x123`
- Obj B is destroyed as well, it tries to delete `0x123` **again**
- Crash, double free error

```cpp {linenos=inline}
#include <algorithm> // For std::copy

class Buffer {
private:
    int* data;
    size_t size;

public:
    // 1. Constructor (Resource Acquisition)
    Buffer(size_t s) : size(s) {
        data = new int[size]; 
        // Fill with dummy data
        for(size_t i=0; i<size; ++i) data[i] = 0;
    }

    // 2. Destructor (Resource Release)
    ~Buffer() {
        delete[] data; // If we didn't implement Copy logic, this would crash on copy!
    }

    // 3. Copy Constructor (Deep Copy)
    // Called when: Buffer b = a;
    Buffer(const Buffer& other) : size(other.size) {
        // A. Allocate NEW memory
        data = new int[size];
        
        // B. Copy the VALUES (Deep Copy), not the pointer
        std::copy(other.data, other.data + size, data);
    }

    // 4. Copy Assignment Operator (Deep Copy)
    // Called when: b = a; (Both already exist)
    Buffer& operator=(const Buffer& other) {
        // A. Self-assignment check (Critical!)
        // If someone writes "a = a;", we shouldn't delete our own data.
        if (this == &other) {
            return *this;
        }

        // B. Clean up OLD memory
        delete[] data;

        // C. Allocate NEW memory and Copy
        size = other.size;
        data = new int[size];
        std::copy(other.data, other.data + size, data);

        // D. Return *this to allow chaining (a = b = c)
        return *this;
    }
};
```

**The rule of three**: If you need to define a custom **Destructor** (to delete memory), you almost certainly _also_ need to define a custom **Copy Constrcutor** and **Copy Assignment Operator** to handle **Deep Copies** (allocating new memory for the copy)

Now with modern C++, there's **the rule of five**: For performance sake, we also add:
- **Move Constructor**, instead of copying data, we _"steal"_  the pointer from the temporary object that is about to die anyway
- **Move assignment operator** 

Typically this is called move semantics

```cpp {linenos=inline}
class Buffer {
    // ... (Previous Rule of Three code goes here) ...

public:
    // 5. Move Constructor
    // Called when: Buffer b = std::move(a);
    // Note: 'other' is not const, because we are going to modify it.
    Buffer(Buffer&& other) noexcept 
        : data(nullptr), size(0) // Initialize self to empty
    {
        // A. Steal the resources
        data = other.data;
        size = other.size;

        // B. Null out the source (So its destructor deletes nothing)
        other.data = nullptr;
        other.size = 0;
    }

    // 6. Move Assignment Operator
    // Called when: b = std::move(a);
    Buffer& operator=(Buffer&& other) noexcept {
        // A. Self-assignment check
        if (this == &other) {
            return *this;
        }

        // B. Clean up OUR old memory (We are being overwritten)
        delete[] data;

        // C. Steal resources
        data = other.data;
        size = other.size;

        // D. Null out the source
        other.data = nullptr;
        other.size = 0;

        return *this;
    }
};
```

**Pro-gamer move**: There's this trick called **Copy-and-Swap**. It simplifies above rules by reusing code and providing strong exception safety. Albeit with an addition of a `swap()` function

```cpp {linenos=inline}
class Buffer {
    int* data;
    size_t size;

public:
    // Constructor
    Buffer(size_t s) : size(s), data(new int[s]) {}
    
    // Destructor
    ~Buffer() { delete[] data; }

    // Copy Constructor (Same as before)
    Buffer(const Buffer& other) : size(other.size), data(new int[other.size]) {
        std::copy(other.data, other.data + size, data);
    }

    // Move Constructor (Same as before)
    Buffer(Buffer&& other) noexcept : data(nullptr), size(0) {
        swap(*this, other);
    }

    // FRIEND SWAP FUNCTION
    // Swaps the guts of two objects efficiently
    friend void swap(Buffer& first, Buffer& second) noexcept {
        using std::swap;
        swap(first.size, second.size);
        swap(first.data, second.data);
    }

    // UNIFIED ASSIGNMENT OPERATOR
    // Handles BOTH Copy-Assign and Move-Assign!
    // Notice the parameter is passed by VALUE (creates a copy or move automatically)
    Buffer& operator=(Buffer other) {
        // Swap our (old) data with the copy's (new) data.
        // When 'other' goes out of scope at the end of this function,
        // the destructor cleans up our old data automatically.
        swap(*this, other);
        return *this;
    }
};
```

### 6e. `explicit` keyword

Prevents accidental type conversion that can cause weird-ass bugs

**The trap:**
```cpp {linenos=inline}
class Health {
public:
    // Constructor that takes ONE argument
    Health(int hp) { ... } 
};

void HealPlayer(Health h) { ... }

// Usage
HealPlayer(50); // <--- This compiles!
```

Compiler sees you passed an `int` (50), sees `Health` has a constructor that takes an `int`, and **implicitly** converts 50 into a `Health` object. This is often confusing and likely unintended

**The fix:**
```cpp {linenos=inline}
class Health {
public:
    explicit Health(int hp) { ... }
};

HealPlayer(50); // Compiler Error!
HealPlayer(Health(50)); // Allowed. You must be explicit.
```

## 7. Stack and Heap allocation

### 7a. The Stack. Fast, automatic but small

Think of The Stack like a _stack_ of plates. **You can only add to the top, and take off the top**.
- Allocation is extremely fast. The CPU internally just moves a pointer, the "Stack Pointer" down to make a room. Typically only cost one CPU instruction
- Deallocation is also extremely fast. The CPU moves the pointer back up. The memory is "freed" instantly
- Lifetime is stricly tied to scope blocks `{}`
- Size limit is very small, usually 1-8MB depending on the OS

```cpp {linenos=inline}
void UpdatePlayer() {
    // Stack Allocation
    // 1. Fast.
    // 2. Automatically deleted when function ends.
    Vector3 position = {10.0f, 20.0f, 30.0f}; 
    
    int health = 100;
    
    // If you create a huge array here, you get a "Stack Overflow"
    // double hugeArray[1000000]; // <--- CRASH
}
```

### 7b. The Heap. Slow, manual but large

Also called the "Free Store", a giant pool of unstructured memory
- Allocation is slow. When calling `new` or `malloc`, the OS **has to search** through The Heap to find a continous block of empty memory that fits the request. This takes time
- Deallocation is slow and manual, must explicity call `delete` or `free`
- Lifetime persists until explicitly destroy it
-  Size limit depends on the physical RAM

```cpp {linenos=inline}
void CreateLevel() {
    // Heap Allocation
    // 1. Slower (OS has to find space).
    // 2. Must be manually deleted.
    Enemy* boss = new Enemy(); 
    
    // ... game runs ...
    
    delete boss; // If you forget this -> Memory Leak.
}
```

### 7c. "Game Loop"

Never allocate on The Heap, inside the main Game Loop (`Tick()`/`Update()`). Why?
- `new` is slow. Doing it 60 times/second (or 1000x a frame for particle systems, perhaps) definitely kills framerate
- Fragmentation, imagine The Heap as a block of Swiss Cheese
  - Allocate 10 bytes, then 20, then 10
  - You delete the middle (20 bytes one)
  - You now have a "hole"
  - If you then later try to allocate 30 bytes, you can't fit it in the hole. You have to go to the end and then _re-allocate_
  - Over hours of gameplay, The Heap becomes a mess of tiny holes (fragmentation), and eventually could cause an out of memory crash even if you technically still have free RAM

Then, when should we use Heap? Use heap for large assets, like textures or levels or objects that need to live longer than the current function scope

However, avoid Heap allocation inside game loop calls to prevent fragmentation and CPU spikes. For temporary data in a frame, prefer the stack


### 7d. Smart Pointers (Modern C++)

Since manual `delete` calls are error-prone, Modern C++ (>= C++11) introduced smart pointers

1. `std::unique_ptr`
- Owns the object `exclusively`, when the pointer goes out of scope, it automatically calls `delete` on the object
- Overhead is _almost_ zero, it's just a wrapper around a raw pointer
- I'd suggest to use this by default for heap objects

```cpp {linenos=inline}
#include <memory>

void SpawnEnemy() {
    // Creates an Enemy on the heap, wrapped in a unique_ptr
    std::unique_ptr<Enemy> e = std::make_unique<Enemy>();
    
    e->Attack();
    
    // No need to call delete! 
    // When 'e' goes out of scope here, the Enemy is deleted.
}
```

2. `std::shared_ptr`
- Multiple pointers can own the same object. The object is only deleted when the _last_ pointer looking at it dies
- Overhead is high since it maintains a "reference count" (internally, an int) that must be thread-safe (atomic). Every time you copy the pointer, it has to ++ or -- the counter
- I'd suggest to use this sparingly, only when ownership **is truly** shared. E.g., texture used by 50 different models. The texture should die when all 50 models are gone

### 7e. The "Pointer-chasing" problem

Connects to a topic called **Cache locality**

- In stack, data is usually contigous (next to each other). CPU **loves this**. It loads a "Cache Line" (typically 64 bytes) and gets all your variables at once
- In heap, the data is scattered randomly
  - If you have a `std::vector<Enemy*>`, the vector is just a list of ptrs
  - To update enemy 1, the CPU jumps address to address A
  - To update enemy 2, the CPU jumps address to address B
  - This jumping causes **Cache misses**, which are very slow

Prefer contigous memory as much as possible, like `std::vector<Enemy>` instead of `std::vector<Enemy*>` because it keeps the data close togehter and avoids "Pointer Chasing" on The Heap.


### 7f. Pro-gamer move: "Memory Arena"

The concept: Heap size, Stack speed

Now that we know that standard heap allocation is slow and causes fragmentation, while stack allocation is fast but the stack is too small - there's a neat trick that carries the best of both worlds called **Memory Arena**

- You allocate **a huge block** of memory on The Heap **at startup**, e.g., 100MB
- You manage this block yourself, using a simple pointer
- To "allocate" an object, you just move the pointer forward
- To "free" memory, you **don't delete** individual objects. Just **reset the pointer** to the start

Essentially this makes it so that:
- Allocating is just an integer addition, O(1), no OS overhead - fast
- Since you allocate objects one after another, they sit next to each other in RAM (cache locality)
- No fragmentation, since you immediately fill the block linearly, no holes
- Instant cleanup since we can free objects contained in the arenas by setting `Head = 0`

```cpp {linenos=inline}
#include <cstddef>
#include <cstdint>
#include <iostream>

class MemoryArena {
private:
    uint8_t* MemoryBlock; // The big chunk of memory
    size_t Size;          // Total size (e.g., 100MB)
    size_t Offset;        // Current "Head" position

public:
    // 1. Startup: Allocate the big block once (using malloc/new)
    MemoryArena(size_t sizeBytes) : Size(sizeBytes), Offset(0) {
        MemoryBlock = new uint8_t[sizeBytes]; 
    }

    // 2. Shutdown: Free the big block
    ~MemoryArena() {
        delete[] MemoryBlock;
    }

    // 3. Allocate: The "Pointer Bump"
    void* Alloc(size_t sizeBytes) {
        // Check if we have space
        if (Offset + sizeBytes > Size) {
            return nullptr; // Out of memory!
        }

        // Get the pointer to the current free spot
        void* ptr = &MemoryBlock[Offset];

        // Move the head forward
        Offset += sizeBytes;

        return ptr;
    }

    // 4. Deallocate: The Magic Reset
    // We don't free individual items. We wipe everything at once.
    void Reset() {
        Offset = 0;
    }
};


// Usage in game loop

struct Particle { float x, y; };

int main() {
    // Create a 1MB Arena
    MemoryArena FrameArena(1024 * 1024); 

    while (GameIsRunning) {
        // Reset the arena at the start of every frame.
        // All memory from the previous frame is effectively "freed".
        FrameArena.Reset(); 

        // Allocate 1000 particles instantly
        for (int i = 0; i < 1000; i++) {
            // We use 'placement new' to construct objects in our custom memory
            void* mem = FrameArena.Alloc(sizeof(Particle));
            Particle* p = new(mem) Particle(); 
        }

        Render();
    }
}
```

When to use this? I found several useful case that benefits from this trick:

1. Frame allocator
I used a linear memory arena for temporary data that only needs to exist **for one frame**. E.g., UI text meshes, temp arrays for physics queries or debug drawing lines. At the end of the frame, I just call `Reset()` lol

2. Level allocator
When loading a level, I typically allocate **all** assets (textures, meshes, etc.) into a specific arena. When the player leaves the level, I don't have to track down _every single texture_ to delete it. I just destroy the entire level arena. Effectively doing instant cleanup and guarantees zero memory leaks between levels

**Important note**

Since `Alloc()` returns a `void*` (raw memory), the constructor is not called automatically. We need to use something called **Placement New**

- Standard `new Player()` -> allocates memory AND calls constructor
- Placement New `new(ptr) Player()` -> uses EXISTING memory `ptr` and calls constructor there

```cpp {linenos=inline}
void* mem = Arena.Alloc(sizeof(Enemy));
Enemy* e = new(mem) Enemy(); // Construct the enemy in our arena
```

## 8. Common C++ containers

Choosing the right container is often a choice between "easy to write" vs "runs fast". Understanding of **Big O notation** and **CPU cache behavior** is important

### 8a. `std::vector`

Under the hood this is just a dynamic array. It allocates a contigous block of memory on The Heap

- Performance:
  - Random access via `v[i]`: O(1)
  - Insertion at the end via `push_back()`: O(1) amortized, usually fast but slow when need to resize
  - Insertion/Deletion in Middle: O(n), since it has to **shift all** subsequent elements in memory
- CPU loves it. Since it's a contigous memory. The data sits side-by-side, thus the CPU loads it into the cache efficiently. Iterating through a vector is the fastest thing a CPU can do

**`reserve()` trick**

When a vector fills up, it has to:
- Allocate a new, bigger block of memory (usually 2x current size)
- Copy **everything** from the old block to the new one
- Delete the old block

This is slow

By reserving a certain number of elements in the array, we'll avoid reallocation

```cpp {linenos=inline}
std::vector<Enemy> enemies;
// If we know we will have roughly 100 enemies:
enemies.reserve(100); 

// Now, the first 100 push_back() calls will NOT trigger a reallocation.
// This prevents memory fragmentation and CPU spikes.
```

**Usage example: Entity Manager** 

Say you have a list of enemies, bullets or particles. You need to update them every single frame, and need maximum iteration speed

```cpp {linenos=inline}
struct Enemy {
    int id;
    float health;
    void Update() { /* AI logic */ }
};

class EnemyManager {
    // CHOICE: vector because we iterate this 60 times a second.
    // The contiguous memory means the CPU cache stays hot.
    std::vector<Enemy> enemies;

public:
    void InitLevel(int enemyCount) {
        // OPTIMIZATION: Reserve memory upfront to prevent resizing lag spikes.
        enemies.reserve(enemyCount); 
        
        for(int i = 0; i < enemyCount; i++) {
            enemies.push_back(Enemy{i, 100.0f});
        }
    }

    void UpdateAll() {
        // Fast iteration
        for (auto& e : enemies) {
            e.Update();
        }
    }
};
```

- Why not List? A list would scatter enemies across memory, causing cache misses every time we move to the next enemy
- Why not Map? We don't need to look them up by ID here, just need to process _all_ of them

### 8b. `std::list`

This is a doubly linked list. Each node contains `the data + a pointer to the next node + a pointer to the previous node` 

- Performance
  - Random access via `l[i]`: O(n), terrible. Since you have to walk the chain from the start to find the nth element
  - Insertion/Deletion: O(1), you just change the pointer. _However_, you have to find the spot first (which takes O(n))
- CPU hates it. Prone to cache misses since the nodes are scattered all over the heap. Iterating a list is significantly slower than a vector because the CPU has to wait for memory fetches constantly
- Use this only when you need to frequently insert/remove items from the _middle_ of the sequence and you already have a pointer to that location

**Usage example: Status effect system**

Say a player might have "Poison", "Regen" and "Stun" effects active. The effects expire at different times and with a random order. We frequently need to delete an effect from the _middle_ of the list when its timer runs out

```cpp {linenos=inline}
struct StatusEffect {
    std::string name;
    float duration;
};

class Player {
    // CHOICE: list because we delete from the middle frequently.
    // Removing an item from a list is just rewiring pointers (cheap).
    // Removing from the middle of a vector requires shifting all data (expensive).
    std::list<StatusEffect> activeEffects;

public:
    void AddEffect(std::string name, float time) {
        activeEffects.push_back({name, time});
    }

    void TickEffects(float deltaTime) {
        auto it = activeEffects.begin();
        while (it != activeEffects.end()) {
            it->duration -= deltaTime;
            
            if (it->duration <= 0) {
                // Efficient removal from middle (No data shifting)
                it = activeEffects.erase(it); 
            } else {
                ++it;
            }
        }
    }
};
```

- Why not Vector? If you have 50 effects and remove index 0, a vector has to _shift the other 49 items_ down one slot. A list just updates two pointers

### 8c. `std::map`

Under the hood, it's usually a Red-Black Tree (Binary Search Tree) that keeps elements **sorted** by key

Performance typically is O(log n) for lookups, insertions and deletions

Use this when you need the data to be sorted

**Usage example: Event Timeline / Replay System**

Say you want to store game events (player jumped, enemy died, etc.) keyed by the **Time** they occured. You need to process them strictly in chronological order

```cpp {linenos=inline}
struct GameEvent {
    std::string action;
    int actorID;
};

class ReplaySystem {
    // CHOICE: map because it automatically sorts by Key (Time).
    // float = Time (Key), GameEvent = Data (Value)
    std::map<float, GameEvent> timeline;

public:
    void RecordEvent(float time, std::string action, int id) {
        // Insertions are O(log n), but they are automatically sorted.
        timeline[time] = {action, id};
    }

    void Playback() {
        // Iterating a map ALWAYS goes from smallest Key to largest Key.
        for (const auto& pair : timeline) {
            float time = pair.first;
            const GameEvent& evt = pair.second;
            
            std::cout << "At " << time << "s: " << evt.action << "\n";
        }
    }
};
```

### 8d. `std::unordered_map`

Under the hood, it's a hash table. It hashes the Key to find a "bucket". Unlike `std::map`, the elements are **stored in random order**

Performance typically O(1), faster than std::map

There's a catch though, if many keys hash to the same bucket (collision), performance degrades to O(n). Also, calculating the Hash takes time

**Usage example: Asset Manager (Texture Cache)**

Say you need to load a texture by its filename. You don't care about the alphabetical order of files; you just want say "Give me `Hero.png`", and get it instantly

```cpp {linenos=inline}
class Texture { /* ... heavy image data ... */ };

class AssetManager {
    // CHOICE: unordered_map for O(1) lookup speed.
    // Key = Filename (string), Value = Pointer to Texture
    std::unordered_map<std::string, Texture*> textureCache;

public:
    Texture* GetTexture(std::string filename) {
        // 1. Check if we already loaded it (Fast lookup)
        auto it = textureCache.find(filename);
        
        if (it != textureCache.end()) {
            return it->second; // Found it! Return existing.
        }

        // 2. Not found, load from disk (Slow)
        Texture* newTex = new Texture(); // (Pseudo-code loading)
        textureCache[filename] = newTex;
        return newTex;
    }
};
```

### 8e. `std::array`

This is a fixed-size array that lives on The Stack, usually.

- Syntax: `std::array<int, 5> myArr;`
- Performance is identical to a raw C-Array (`int myArr[5]`)
- Use this over raw C-Array since it adds safe and handy features like `.size()` for capacity check and `.at()` for bounds checking, without any neglible performance cost

**Usage example:  Equipment Slots**

```cpp {linenos=inline}
class PlayerEquipment {
public:
    enum Slot { HEAD, CHEST, LEGS, FEET, COUNT };

    // CHOICE: array because the size is known at compile time (4 slots).
    // It lives on the Stack (inside the class), avoiding Heap allocation overhead.
    std::array<int, Slot::COUNT> itemIDs;

    PlayerEquipment() {
        // Safe filling
        itemIDs.fill(0); 
    }

    void Equip(Slot s, int id) {
        // .at() provides bounds checking (throws error if s is invalid)
        // unlike raw C-arrays which would just overwrite random memory.
        itemIDs.at(s) = id; 
    }
};
```
- Why not Vector? A vector would allocate heap memory for just 4 integers. That's wasteful.

### 8f. Pro-gamer move: Swap-and-Pop array (Unordered array/Swapback array)

As described above, deleting an object from a `std::vector` without `reserve()`-ing it ahead of time is inefficient. The following container is a simple workaround, albeit with a glaring downside

If you **don't care about the order** of elements, you can use a technique called Swap-and-Pop

- The technique:
  - Take the **last element** in the array
  - Copy/Move it into the slot of the **dead element**
  - Delete the **last element** (cheap!)
- Cost: O(1), moved **exactly** one object

- Use this when:
  - Order doesn't matter. E.g., particle system, pool of active enemies, list of SFXs, etc.
  - Frequent deletions, you add and remove items constantly every frame
- Don't use this when:
  - Order matters. E.g., rendering layer. Don't show background layer on after UI layer and vice versa
  - Indices are cached externally. If another system holds "index 5" to refer to a specific enemy, and you swap a different enemy into index 5, the other system will now point to the wrong enemy

**Implementation**:
```cpp {linenos=inline}
// We can implement this as a wrapper around std::vector

#include <vector>
#include <cassert>

template <typename T>
class SwapbackArray {
private:
    std::vector<T> data;

public:
    // Standard access
    T& operator[](size_t index) { return data[index]; }
    const T& operator[](size_t index) const { return data[index]; }
    size_t size() const { return data.size(); }
    
    // O(1) Insertion (Same as vector)
    void push_back(const T& value) {
        data.push_back(value);
    }

    // THE MAGIC: O(1) Removal
    void remove_at(size_t index) {
        assert(index < data.size());

        // 1. Overwrite the item to be removed with the last item
        // We use std::move to be efficient if T is a complex object
        data[index] = std::move(data.back());

        // 2. Remove the last item (now that it has been moved)
        // pop_back on a vector is O(1)
        data.pop_back();
    }
};

// Usage example: A particle system. We iterate through particles. If one dies, remove it instantly without breaking the loop or shifting memory

struct Particle {
    float lifeTime;
    float x, y;
};

int main() {
    SwapbackArray<Particle> particles;

    // Spawn 10,000 particles
    for(int i=0; i<10000; i++) {
        particles.push_back({10.0f, 0, 0});
    }

    // Update Loop
    // NOTICE: We iterate BACKWARDS or handle the index carefully
    // because swapping changes the current index!
    for (size_t i = 0; i < particles.size(); /* no increment here */) {
        
        Particle& p = particles[i];
        p.lifeTime -= 0.016f; // DeltaTime

        if (p.lifeTime <= 0) {
            // O(1) Removal
            // The particle at 'i' is replaced by the last particle.
            // We do NOT increment 'i', because we need to process 
            // the *new* particle that just got swapped into this slot.
            particles.remove_at(i);
        } else {
            // Only increment if we didn't remove
            ++i;
        }
    }
    
    return 0;
}
```

### 8g. Iterator Invalidation

What happens to iterators when you modify a container?

Say you're looping through a `vector` of enemies, and you decide to delete one

```cpp {linenos=inline}
std::vector<int> numbers = {1, 2, 3, 4, 5};

for (auto it = numbers.begin(); it != numbers.end(); ++it) {
    if (*it == 3) {
        numbers.erase(it); // <--- CRASH / Undefined Behavior
        // The 'erase' function invalidates the iterator 'it'.
        // The loop then tries to do '++it' on a dead iterator.
    }
}
```

**The fix**:
```cpp {linenos=inline}
for (auto it = numbers.begin(); it != numbers.end(); /* empty */) {
    if (*it == 3) {
        it = numbers.erase(it); // Update 'it' to the next valid element
    } else {
        ++it; // Only increment if we didn't delete
    }
}
```

## 9. Strings

### 9a. Cost of `std::string`

Unlike an `int` (which is just 4 bytes on stack), a `std::string` is a complex object

- Heap allocation: If the text is long, `std::string` calls `new` to store the characters on The Heap
- Copying is expensive (`std::string a = b;`) usually triggers a heap allocation and memory copy (`memcpy`)
- When the string goes out of the scope, it calls `delete`

The following code  allocates and frees memory every single frame (60 times/sec). This causes heap fragmentation and CPU overhead. We should cache the string or use a fixed-size buffer

```cpp {linenos=inline}
void UpdateHUD(int score) {
    // 1. Converts int to string (allocation)
    // 2. Creates "Score: " (allocation)
    // 3. Concatenates them (allocation + copy)
    std::string text = "Score: " + std::to_string(score); 
    
    RenderText(text);
} // text is destroyed (deallocation)
```

### 9b. SSO (Small String Optimization)

This is a compiler optimization in `std::string`. To avoid the expensive heap allocation for short strings like "Name", "HP", "Ammo", `std::string` has a small internal buffer (typically 15-22 chars) directly inside the object itself

- Short string (< 16 chars) -> stored on The Stack, inside the object itself. Fast, no `new`/`delete`
- Long string (> 16 chars) -> stored on The Heap, slow

Keep frequently used strings, like obj names or tags short enough to fit in SSO so it can avoid heap allocation

### 9c. `const char*` vs `std::string` vs `std::string_view`

#### 1.`const char*`, the C-Style String
- Just a pointer to a read-only array of chars ending in a null terminator `\0`
- Zero overhead, it's just a pointer (8 bytes)
- Unsafe, since you don't know the size. Have to use `strlen()` to find the length, which is O(n)

#### 2. `std::string`
- Safe, easy to resize, owns the memory
- It's heavy since it does allocations
- Use this when you need to _store_ or _modify_ texts

#### 3. `std::string_view`
- A lightweight wrapper that looks at an existing string, either `char*` or `std::string` without actually copying it. Consists of just a pointer and a length
- Use this for **function parameters**

```cpp {linenos=inline}
// BAD: Copies the string (Heap allocation if long)
void ProcessName(std::string name) { ... }

// BETTER: Pass by const reference (No copy, but requires a std::string input)
void ProcessName(const std::string& name) { ... }

// BEST (C++17): Accepts "char*" OR "std::string" with ZERO copies/allocations
void ProcessName(std::string_view name) { 
    if (name == "Player") { ... } // Fast comparison
}
```

### 9d. String Hashing

Comparing strings (`"Player" == "Player"`) is slow. It has to check every character; `P == P`, `l == l`, etc. This is O(n), where n is the length of the  string

Hashing/interning is used to get around this. In Unreal , we convert strings into integers (Hashes)

- "Player" -> Hash function -> `0xA1B2C3D4`
- "Enemy" -> Hash function -> `0xE5F6G7H8`

Then the comparison becomes:
`if (0xA1B2C3D4 == 0xE5F6G7H8)`, just a single integer comparison. O(1), extremely fast

In UE, `FName` is a hashed string. It is **case-insensitive** and **immutable**. It is used to identify assets, bones and sockets cz comparison is instant

### 9e. `snprintf() / fmt()` for Formatting

Concatenating strings with `+` is slow and messy

`std::string s = "Health: " + std::to_string(hp) + " / " + std::to_string(maxHp);`

**Better alternatives**:

#### `snprintf` (C-Style). Fast, writes to a stack buffer
```cpp {linenos=inline}
char buffer[64];
snprintf(buffer, sizeof(buffer), "Health: %d / %d", hp, maxHp);
```

#### `std::format` (C++20). Type-safe, fast and modern
```cpp {linenos=inline}
std::string s = std::format("Health: {} / {}", hp, maxHp);
```


## 10. Alignment and Padding

### 10a. CPU word size

The CPU reads memory **in chunks**, not byte-by-byte

- A 64-bit CPU wants to read data from addresses that are multiples of 8 (64 bits)
- A 32-bit integer wants to live at an address that is divisible by 4

If you put a 4-byte `int` at address `0x01` instead of `0x00` or `0x04`, the CPU has to do extra work (two reads + bit shifting) to get that number

This is called **Unaligned Access**. To prevent this, the compiler automatically inserts **Padding** (empty bytes)

### 10b. Padding visualizatoin

Let's look at the following struct. You might think the size is just the sum of its parts. It's not

**Naive struct**:

```cpp {linenos=inline}
struct BadStruct {
    char a;     // 1 byte
    // --- 3 bytes of PADDING inserted here ---
    int b;      // 4 bytes (Needs 4-byte alignment)
    char c;     // 1 byte
    // --- 3 bytes of PADDING inserted here ---
    // Total Size: 1 + 3 + 4 + 1 + 3 = 12 bytes
};
```

- `int b` needs to start at an address divisible by 4. Since `char a` only took 1 byte, the compiler adds 3 junk bytes so `b` starts at offset 4
- We're wasting 6 bytes due to padding (50%!)

**Nicely packed struct**:

```cpp {linenos=inline}
struct GoodStruct {
    int b;      // 4 bytes
    char a;     // 1 byte
    char c;     // 1 byte
    // --- 2 bytes of PADDING at the end ---
    // Total Size: 4 + 1 + 1 + 2 = 8 bytes
};
```

The key is to **reorder variables from largest to smallest**. Doing so, we reduced the size from 12 bytes -> 8 bytes

This looks like it won't matter that much, but consider if you have an array of 1.000.000 particles, 
- `BadStruct` -> 12MB RAM usage
- `GoodStruct` -> 8MB RAM usage

We saved 4MB of RAM usage and significantly reduced the number of times the CPU has to fetch data from main memory due to fewer cache misses

### 10c. `alignof` and `sizeof`

Consider the following:

```cpp {linenos=inline}
std::cout << sizeof(BadStruct); // Output: 12
std::cout << alignof(BadStruct); // Output: 4 (Because the largest member is an int)
```

The alignment of a struct is _usually_ equal to the alignment of its largest member

### 10d. Cache lines (the 64-byte rule)

Modern CPUs fetch memory in "Cache Lines", typically 64 bytes

- When you ask for `Variable A`, the CPU fetches **`Variable A` + the next ~60 bytes of data automatically**
- The key here is you want your struct **to fit nearly inside a cache line** so CPU gets _everything_ in one go

**Important note**:

There's a condition called **False sharing**, where 2 threads are writing to 2 different variables that _happen_ to sit on the _same_ cache line. The CPU cores fight over that cache line, causing massive slowdowns

To fix this, use `alignas(64)` to force a variable to start on a new cache line

```cpp {linenos=inline}
struct ThreadSafeCounter {
    alignas(64) int counterA; // Thread 1 uses this
    alignas(64) int counterB; // Thread 2 uses this
    // Now they are far apart in memory. No fighting.
};
```

### 10d. SIMD (Single Instruction, Multiple Data) alignment (vectorization)

#### SIMD concept

If you are doing heavy math (physics, graphics), you might use SIMD (Single Instruction, Multiple Data) instructions (SSE/AVX)

- These instructions operate on `4 floats` _at once_ (128 bits) or `8 floats` (256 bits)
- It is important that the data _must_ be aligned to 16 bytes (for SSE) or 32 bytes (for AVX). Otherwise, the program might crash

UE uses this internally inside `FVector`, often aligned specifically to allow fast math operations

Normal C++ code is SISD (Single Instruction, Single Data)

`float c = a + b;`, simple enough - one addition

#### Alignment requirement

To load data into these special registers efficiently, the memory address **must** be a multiple of the register size (typically 16 bytes for SSE)

- Aligned load via `_mm_load_ps`: Fast, requires the addrress to end in `0`, `10`, `20`, etc. (Hex!)
- Unaligned load via `__mm_loadu_ps`: Historically slower, nowadays it's negligible on modern CPUs. Safe to use on _any_ address
- The crash is if you use Aligned load instruction on address that is _NOT_ aligned, e.g., ends in `0x04`. The CPU will throw a hardware exception and the game crashes instantly


#### Concrete example, the vector class

**The "Normal" Class (Dangerous for SIMD)**:
```cpp {linenos=inline}
struct Vector4 {
    float x, y, z, w; 
    // Size: 16 bytes.
    // Alignment: 4 bytes (because 'float' needs 4-byte alignment).
};

void Math() {
    // This might be allocated at address 0x1004.
    Vector4 v; 
}
```

**The "SIMD-Ready" Class**:
```cpp {linenos=inline}
// We use the alignas keyword (C++11) to force the compiler to pad the memory so it always starts on a 16-byte boundary.

#include <immintrin.h> // Header for SIMD intrinsics (SSE/AVX)

// Force this struct to always start at a memory address divisible by 16
struct alignas(16) Vector4SIMD {
    float x, y, z, w;
};

void FastAdd(Vector4SIMD* a, Vector4SIMD* b, Vector4SIMD* result) {
    // 1. Load data from RAM into 128-bit CPU Registers
    // _mm_load_ps REQUIRES 16-byte alignment.
    // If we didn't use alignas(16) above, this line would CRASH.
    __m128 vecA = _mm_load_ps(&a->x); 
    __m128 vecB = _mm_load_ps(&b->x);

    // 2. Do the math (Add 4 floats at once)
    __m128 vecRes = _mm_add_ps(vecA, vecB);

    // 3. Store back to RAM
    _mm_store_ps(&result->x, vecRes);
}
```

#### Heap allocation gotcha

`alignas(16)` works perfectly for variables on the **Stack** or **Global** variables. The compiler handles it

**However**, if you use `new`:

`Vector4SIMD* ptr = new Vector4SIMD();`

The standard `new` operator **does not guarantee 16-byte alignment** on all platforms, especially older Windows versions. It might give you an address ending in `8`

**The fix**:

Override the `new` and `delete` operators for your class to use `_aligned_malloc` for Windows or `posix_memalign` for Linux/Consoles

```cpp {linenos=inline}
struct alignas(16) Vector4SIMD {
    float x, y, z, w;

    // Override new to ensure heap allocation is aligned
    void* operator new(size_t i) {
        return _aligned_malloc(i, 16);
    }

    void operator delete(void* p) {
        _aligned_free(p);
    }
};
```

## 11. V-Table, or how Virtual Functions work

How does the computer actually know which function to call at runtime?

When a class has at least one `virtual` function, the compiler _secretly_ adds a hidden pointer to the class called the `vptr` (vritual pointer). This points to a static table in memory called `vtable` (virtual table)

- The vtable is an array of function pointers, shared by all objects of that class
- The cost:
  - Memory, every object gets 8 bytes larger (on 64-bit systems) to hold the `vptr`
  - Performance, calling a virtual function requires an extra memory lookup. Dereferencing `vptr` -> finding function address -> actually calling it. Again, this could cause cache miss due to indirect lookup. This also prevent compiler from inlining the function

Then, every function shouldn't be virtual. Because of the overhead explained above

```cpp {linenos=inline}
class Base {
    int x;
    virtual void Bark() {} // <--- Causes creation of vtable
};

// Memory Layout of 'Base' object:
// [ vptr ] (8 bytes) -> Points to Base::vtable
// [  x   ] (4 bytes)
// [ pad  ] (4 bytes)
```

## 12. C++ casting

In games, you constantly have a generic pointer (e.g., `AActor*` in Unreal or `GameObject` in Unity) and you need to cast it to a specific class (e.g., `Player*`)

### 12a. `static_cast<T>`

I like to call this the "I know what I'm doing" cast lol

- When? Compile-time check. Used when you are 100% sure the types are compatible (e.g., `float` to `int`, or `Base` to `Derived` if you are certain).
- Cost is free, zero runtime overhead
- Danger: If you cast a generic `Enemy*` to `Boss*`, but it was actually a `Minion*`, the game will crash or have a corrupted memory

### 12b. `dynamic_cast<T>`

This is the "safety check" cast

- When? Runtime check. Used when you don't know what the object is
- If the cast is illega, it returns `nullptr`
- Cost is slow, since it relies on RTTI (Run-time type information). It has to crawl through the class hierarchy string names to check compatibility
- Many game engines like UE disable RTTI for performance and provide their own version `Cast<T>`

### 12c. `const_cast<T>`
- When? To remove the `const` property
- Red flag: If you use this, you usually designed your architecture wrong

### 12d. `reinterpret_cast<T>`

Or as how I like to call it the "Trust me, bro" cast lol

- When? Treating bits as something else. e.g., Casting a pointer to an integer
- Usage is typically in low-level networking or serialization


### 12e. Example

```cpp {linenos=inline}
void OnHit(Entity* other) {
    // BAD: C-Style cast (Hard to search for, unsafe)
    // Player* p = (Player*)other; 

    // GOOD: Dynamic cast (Safe, but slow)
    Player* p = dynamic_cast<Player*>(other);
    if (p) {
        p->TakeDamage();
    }
    
    // BEST (In Unreal Engine):
    // Player* p = Cast<Player>(other); // Uses custom fast casting
}
```

## 13. `const` correctness

This is a "character trait", shows you are **disciplined**

If a function does not modify the object, it **must** be marked as `const`

Why?
- Safety, the compiler will error if you accidentally change a variable inside the function body
- API design, implicitly tells other programmer that "it's safe to call this function, this won't break anything since it doesn't mutate any value"

I typically got caught off-guard about this: `const int*` vs `int* const`
- `const int* ptr`: The data is constant. (You can't change the value `*ptr = 5`, but you can move the pointer `ptr++`)
- `int* const ptr`: The pointer is constant. (You can change the value `*ptr = 5`, but you can't move the pointer `ptr++`)
- `const int* const ptr`: Both are constant

```cpp {linenos=inline}
class Weapon {
    int ammo;
public:
    // This function MUST be const because it just reads data.
    int GetAmmo() const { 
        // ammo--; // <--- Compiler Error! Good!
        return ammo; 
    }

    // This function cannot be const because it changes state.
    void Fire() { 
        ammo--; 
    }
};

void UpdateUI(const Weapon& w) {
    // Because 'w' is passed as const reference...
    std::cout << w.GetAmmo(); // Allowed (GetAmmo is const)
    // w.Fire(); // Compiler Error! (Fire is not const)
}
```

## 14. Special Member Functions (The Implicit Rules)

We touched on the Rule of three and five. But you need to know exactly **what** the compiler generates for you and **when** it stops doing so

The 6 special members:
1. Default Constructor
2. Destructor
3. Copy Constructor
4. Copy Assignment Operator
5. Move Constructor
6. Move Assignment Operator

The hidden rules:
1. If you declare _any_ constrctor, the compiler **stops generating the Default Constructor**
2. If you declare a Move operation, be it constructor or assignment, the compiler **deletes** the Copy operations implicitly

Rule 2 caught me off-guard so many times

Say you write this:

```cpp {linenos=inline}
class Player {
    int health;
    std::string name;
};
```

Here is the **exact** code the compiler generates behind the scenes. It performs **Member-wise** operations

```cpp {linenos=inline}
class Player {
    int health;
    std::string name;

public:
    // 1. Implicit Default Constructor
    // It calls the default constructor of every member.
    // Note: 'health' (int) is NOT initialized (contains garbage) because it's a primitive.
    // 'name' (string) IS initialized to "" because std::string has a constructor.
    Player() : health(), name() {} 

    // 2. Implicit Destructor
    // Calls destructors of members in REVERSE order of declaration.
    ~Player() {
        // name.~string(); // Called automatically
        // health (int) has no destructor, so nothing happens.
    }

    // 3. Implicit Copy Constructor
    // Copies every member.
    Player(const Player& other) 
        : health(other.health), name(other.name) {} 

    // 4. Implicit Copy Assignment Operator
    Player& operator=(const Player& other) {
        health = other.health;
        name = other.name; // Calls std::string::operator=
        return *this;
    }

    // 5. Implicit Move Constructor
    // Casts every member to r-value reference (std::move).
    Player(Player&& other) 
        : health(std::move(other.health)), name(std::move(other.name)) {}

    // 6. Implicit Move Assignment Operator
    Player& operator=(Player&& other) {
        health = std::move(other.health);
        name = std::move(other.name); // Calls std::string::operator=(string&&)
        return *this;
    }
};
```

Typical game engine usage: `delete` keyword

In games, many object like `RenderContext` and `NetworkSocket` **should never be copied**. You must **explicitly** disable these functions

```cpp {linenos=inline}
class Texture {
public:
    // 1. Allow Default Construction
    Texture() = default;

    // 2. DISABLE Copying (Unique Asset)
    // If someone tries: Texture b = a; -> Compiler Error.
    Texture(const Texture&) = delete;
    Texture& operator=(const Texture&) = delete;

    // 3. ALLOW Moving (Transfer ownership)
    Texture(Texture&&) = default;
    Texture& operator=(Texture&&) = default;
};
```

## 15. CRTP (Curiously Recurring Template Pattern)

This is a technique to achieve **Polymorphism** (overriding behavior) without **Virtual Functions**. Weird, right?

Why it matters?
Virtual functions have runtime overhead (vtable lookup). CRTP resolves the function call at **Compile Time**. It is heavily used in engine math libraries and ECS frameworks

The pattern: The Base class takes the Derived class as a template parameter

`class Derived : public Base<Derived> { ... }`

```cpp {linenos=inline}
template <typename Derived>
class SpriteBase {
public:
    void Draw() {
        // STATIC POLYMORPHISM
        // We cast 'this' to the Derived type at compile time.
        // No vtable. No runtime lookup. The compiler inlines this.
        static_cast<Derived*>(this)->DrawImplementation();
    }
};

class PlayerSprite : public SpriteBase<PlayerSprite> {
public:
    void DrawImplementation() {
        std::cout << "Drawing Player\n";
    }
};

class EnemySprite : public SpriteBase<EnemySprite> {
public:
    void DrawImplementation() {
        std::cout << "Drawing Enemy\n";
    }
};

// Usage
template <typename T>
void Render(SpriteBase<T>& sprite) {
    sprite.Draw(); // Calls specific implementation directly
}
```

## 16. SFINAE (Substitution Failure Is Not An Error)

C++ and their stupid naming. Sounds scary but this is actually useful

It allows you to write functions that _only exist_ for specific types

Why it matters?

You might want a generic `Serialize()` function, but you'd like it to behave differntly for `int`, `struct`, and `ptrs`. SFINAE lets you enable/disable functions based on the type passed in

```cpp {linenos=inline}
#include <type_traits>
#include <iostream>

// Function 1: Only compiles if T is a Floating Point number (float, double)
template <typename T>
typename std::enable_if<std::is_floating_point<T>::value, void>::type
ProcessMath(T value) {
    std::cout << "Processing Float: " << value << "\n";
}

// Function 2: Only compiles if T is an Integer (int, long)
template <typename T>
typename std::enable_if<std::is_integral<T>::value, void>::type
ProcessMath(T value) {
    std::cout << "Processing Int: " << value << "\n";
}

int main() {
    ProcessMath(10.5f); // Calls Function 1
    ProcessMath(5);     // Calls Function 2
    // ProcessMath("String"); // Compiler Error: No matching function found!
}
```

## 17. Concepts (C++20's replacement for SFINAE)

In the previous section, we looked at SFINAE (`std::enable_if`). It is ugly, hard to read, and produces terrifying compiler error messages (often 100 lines of template garbage)

**Concepts** are the modern replacement. They allow you to specify **Constraints** on template parameters in plain English

### 17a. Replacing SFINAE with concepts

Let's rewrite the Math example from the previous section

SFINAE code:

```cpp {linenos=inline}
template <typename T>
typename std::enable_if<std::is_integral<T>::value, void>::type
Process(T value) { ... }
```

Concepts code:

```cpp {linenos=inline}
#include <concepts>

// Syntax 1: The "requires" clause
template <typename T>
requires std::integral<T> // <--- Readable!
void Process(T value) {
    std::cout << "Processing Int: " << value << "\n";
}

// Syntax 2: Abbreviated Template (Even cleaner)
void Process(std::floating_point auto value) {
    std::cout << "Processing Float: " << value << "\n";
}
```

### 17b. Custom Concepts aka. Duck Typing

You can define a Concept that says: "_Look, I don't care what class this is, as long as it has a `Draw()` function_".

Define the concept:

```cpp {linenos=inline}
template <typename T>
concept Renderable = requires(T a) {
    { a.Draw() } -> std::same_as<void>; // Must have Draw() returning void
    { a.GetZOrder() } -> std::convertible_to<int>; // Must have GetZOrder() returning int
};
```

Using the concept:

```cpp {linenos=inline}
class Player { 
public: 
    void Draw() {} 
    int GetZOrder() { return 1; }
};

class SoundManager { 
    // No Draw() function
};

// This function ONLY accepts types that fit the 'Renderable' concept
void RenderObject(Renderable auto& obj) {
    obj.Draw();
}

int main() {
    Player p;
    RenderObject(p); // OK!

    SoundManager s;
    // RenderObject(s); 
    // ERROR: "SoundManager does not satisfy concept Renderable. 
    //        because 'a.Draw()' would be invalid."
}
```

## 18. Template Metaprogramming (TMP)

Wikipedia calls it "art" of writing code that runs entirely during **Compilation**. Depending on your use-case though, this might actually complicate things and "muck" the "art"

Why it matters?
If you can calculate something at compile time, like Sine Table or a String Hash, the CPU can save cycles at runtime. As they say, "Runtime is expensive, Compile time is free"

In modern C++, we use `constexpr`. Unlike old C++ that uses recursive templates, starting from C++17 onwards, we use `constexpr` instead, which look like normal code but runs during compilation

Code example: Compile-time String Hashing
As discussed in the String section, game engines typically hashes Strings into integer IDs for faster comparison and indexing. With TMP, we can hash the string `"Player.png"` into an integer `0xA1B2` _while the game is compiling_

```cpp {linenos=inline}
// C++17 constexpr function
constexpr uint32_t HashString(const char* str) {
    uint32_t hash = 5381;
    while (*str) {
        hash = ((hash << 5) + hash) + *str; // hash * 33 + c
        str++;
    }
    return hash;
}

int main() {
    // This calculation happens inside the compiler.
    // The resulting binary just contains the number: 228562779
    // NO runtime CPU cost.
    constexpr uint32_t PlayerID = HashString("Player");

    switch(InputID) {
        case PlayerID: // We can even use it in switch cases!
            // ...
            break;
    }
}
```

# OOP vs DOD

A trendy topic. Game engines like Unity with DOTS and UE with Mass Entity are traditionally an OOP engine that attempting to move towards DOD. But why?

## 1. The fundamental difference
- OOP, _object-oriented_. Organizes code around "**Things**" (Objects)
  - _Mental model_: A `Player` is a:
    - Box that contains
      - `Health`
      - `Pos`
      - `Velocity`
      - `Update()` func
- DOD, _data-oriented_. Organizes code around "**Data**" (Arrays)
  - _Mental model_: There's arrays of:
    - `Healths`
    - `Positions`
    - `Velocities`
  - Player is just an `index` in all those arrays

## 2. The hardware reality (CPU cache)

- CPU is _super_ fast. While RAM is slow
- When the CPU asks for data, it fetches a **Cache Line** (64 bytes)
- Your goal is to: if you fetch 64 bytes, you want _all_ 64 bytes to be **useful** data

**The OOP problem (Array of Structs - AoS)**

Imagine you have an array of `Enemy` objects. You'd want to update their positions via `Pos += Vel * dt`

```cpp {linenos=inline}
class Enemy {
    bool isDead;        // 1 byte (+3 padding)
    Vector3 position;   // 12 bytes
    Vector3 velocity;   // 12 bytes
    int aiState;        // 4 bytes
    float health;       // 4 bytes
    Texture* sprite;    // 8 bytes
    // Total: ~48 bytes per Enemy
};

std::vector<Enemy> enemies; // The "Array of Structures"
```

The loop: 
```cpp {linenos=inline}
for (auto& e : enemies) {
    e.position += e.velocity * dt;
}
```

What the CPU sees:
1. Fetch `Enemy[0]`. We need `position` and `velocity` (24 bytes)
2. We also loaded `isDead`, `aiState`, `health`, and `sprite` into the cache. **We don't need them.** That is "Waste
3. Because the struct is large (48 bytes), a 64-byte cache line can only hold **1.3 enemies**
4. To update 1000 enemies, we need to fetch from RAM hundreds of times, slow

**The DOD approach (Structs of Arrays - SoA)**

Instead of one class, we split the data into separate arrays

```cpp {linenos=inline}
struct EnemySystem {
    std::vector<Vector3> positions;
    std::vector<Vector3> velocities;
    std::vector<float> healths;
    std::vector<int> aiStates;
};
```

The loop: 
```cpp {linenos=inline}
// We only touch the position and velocity arrays
for (int i = 0; i < count; i++) {
    positions[i] += velocities[i] * dt;
}
```

What the CPU sees:
1. We load the `positions` array. It is _just_ Vector3s
2. A 64-byte cache line holds **5.3 positions** (12 bytes each)
3. We load the `velocities` array

We process 4-5x more enemies per RAM fetch and this layout is perfectfor **SIMD**. Allowing the CPU to update 4 positions at once

## 3. When to use OOP vs DOD?

DOD by itself is not a silver bullet. It is harder to write and debug

- Use OOP for:
  - The Main Player (Complex logic, lots of unique state)
  - UI Systems
  - Game Mode / Game State logic
  - Interaction systems (Doors, Chests)

- Use DOD for:
  - 10,000 Zombies
  - Particle Systems
  - Traffic simulation
  - Anything where you have **lots of objects doing the same thing**

## 4. Converting OOP -> DOD code example

OOP style
```cpp {linenos=inline}
class Ball {
    Vector3 pos, vel;
public:
    void Update(float dt) {
        pos += vel * dt;
    }
};
std::vector<Ball> balls;
// Update: balls[i].Update(dt); -> Pointer chasing / Cache pollution
```

DOD style
```cpp {linenos=inline}
struct BallData {
    std::vector<Vector3> positions;
    std::vector<Vector3> velocities;
};

void UpdateBalls(BallData& data, float dt) {
    size_t count = data.positions.size();
    
    // This loop is incredibly fast and auto-vectorizable by the compiler
    for (size_t i = 0; i < count; ++i) {
        data.positions[i] += data.velocities[i] * dt;
    }
}
```

## 4. ECS
ECS is the formal architectural pattern for Data-Oriented Programming.

- Entity is just an ID (int), e.g., `Entity #50`
- Component: **Pure Data. No functions**
  - `PositionComponent { x, y, z }`
  - `VelocityComponent { x, y, z }`
- System: The logic itself. Runs on arrays of components
  - `MovementSystem`: Iterats _all_ `Position` and `Velocity` components, and adds them

- ECS uses a 'Structure of Arrays' layout which maximizes Cache Locality 
- By keeping similar data contiguous in memory, we reduce Cache Misses
- It also decouples logic from data, making it easier to parallelize (multithread) updates because systems don't have complex dependencies like OOP inheritance trees

**Mini, native ECS implementation**
```cpp {linenos=inline}
#include <vector>
#include <iostream>

// ==========================================
// 1. COMPONENTS (Pure Data)
// ==========================================
struct Position {
    float x, y;
};

struct Velocity {
    float x, y;
};

// ==========================================
// 2. THE ECS MANAGER (The "Database")
// ==========================================
class ECSManager {
public:
    // DEFINITION OF "ENTITY":
    // An Entity is just an index into these arrays.
    // Entity 0 is index 0, Entity 1 is index 1.
    
    // STORAGE (Structure of Arrays - SoA):
    // Instead of vector<Object>, we have vectors of data types.
    // This ensures contiguous memory for the CPU cache.
    std::vector<Position> positions;
    std::vector<Velocity> velocities;
    
    // MASKS:
    // We need to know which entity has which component.
    // (In a real engine, we'd use a Bitmask, e.g., 0b0011)
    std::vector<bool> hasPosition;
    std::vector<bool> hasVelocity;

    // Create a new "Entity" (Just resizing the arrays)
    int CreateEntity() {
        positions.emplace_back();
        velocities.emplace_back();
        hasPosition.push_back(false);
        hasVelocity.push_back(false);
        return positions.size() - 1; // Return the ID
    }

    // Add Component Functions
    void AddPosition(int entityID, float x, float y) {
        positions[entityID] = {x, y};
        hasPosition[entityID] = true;
    }

    void AddVelocity(int entityID, float x, float y) {
        velocities[entityID] = {x, y};
        hasVelocity[entityID] = true;
    }
};

// ==========================================
// 3. THE SYSTEM (The Logic)
// ==========================================
class MovementSystem {
public:
    void Update(ECSManager& ecs, float deltaTime) {
        // THE PERFORMANCE MAGIC:
        // We iterate through raw data arrays. 
        // The CPU loads a chunk of Positions, then a chunk of Velocities.
        // Very few cache misses compared to jumping between Objects.
        
        size_t count = ecs.positions.size();

        for (size_t i = 0; i < count; ++i) {
            // Check if this entity has BOTH components required for movement
            if (ecs.hasPosition[i] && ecs.hasVelocity[i]) {
                
                // Logic: Pos += Vel * dt
                ecs.positions[i].x += ecs.velocities[i].x * deltaTime;
                ecs.positions[i].y += ecs.velocities[i].y * deltaTime;
            }
        }
    }
};

// ==========================================
// 4. USAGE
// ==========================================
int main() {
    ECSManager ecs;
    MovementSystem mover;

    // 1. Create Entities
    int playerID = ecs.CreateEntity();
    ecs.AddPosition(playerID, 0, 0);
    ecs.AddVelocity(playerID, 10, 5); // Player moves

    int treeID = ecs.CreateEntity();
    ecs.AddPosition(treeID, 50, 50); 
    // Tree has NO velocity, so the system will skip it

    // 2. Game Loop
    float dt = 0.016f; // 60 FPS
    
    mover.Update(ecs, dt);

    std::cout << "Player Pos: " << ecs.positions[playerID].x << "\n"; // Output: 0.16
    std::cout << "Tree Pos: "   << ecs.positions[treeID].x   << "\n"; // Output: 50 (Unchanged)

    return 0;
}
```

**IMPORTANT NOTE**

- This is a naive implementation where the Entity ID matches the Array Index
- In a real engine (like EnTT or FLECS), we would use Sparse Sets or Archetypes to handle the fact that not all entities have all components, to avoid wasting memory on empty slots

## 5. Parallelization

### 5a. OOP concurrency problem

Why is it hard to multithread standard OOP code?
- Hidden Dependencies: Object A might call `ObjectB->GetHealth()`. If Thread 1 updates Object A and Thread 2 updates Object B, you might get a race condition
- Deadlocks: To fix race conditions, you add Mutexes/Locks. If A locks B, and B locks A, the game freezes
- Pointer Chasing: Threads spend more time waiting for RAM (Cache Misses) than actually doing math

### 5b. Data parallelism

In ECS, we have a contiguous array of `Positions`

- Independence: Updating `Position[0]` has zero effect on `Position[1]`
- The Strategy: We don't need complex locks. We just split the array
  - Core 1: Updates indices 0 to 5,000
  - Core 2: Updates indices 5,001 to 10,000

### 5c. Code example

We extend the previous Mini-ECS. We will use C++17 Parallel Algorithms (`std::execution::par`) to show how trivial this becomes with DOD. In UE, you'd use `ParallelFor` instead

```cpp {linenos=inline}
#include <execution> // C++17 Parallel Policies
#include <algorithm> // for std::for_each
#include <numeric>   // for std::iota

class MovementSystem {
public:
    // 1. Single-Threaded (Old Way)
    void UpdateSerial(ECSManager& ecs, float dt) {
        for (size_t i = 0; i < ecs.positions.size(); ++i) {
            ProcessEntity(ecs, i, dt);
        }
    }

    // 2. Multi-Threaded (The DOD Way)
    void UpdateParallel(ECSManager& ecs, float dt) {
        size_t count = ecs.positions.size();
        
        // Helper: Create a vector of indices [0, 1, 2, ... count-1]
        // We need this to iterate over indices in parallel.
        std::vector<int> indices(count);
        std::iota(indices.begin(), indices.end(), 0);

        // EXECUTE IN PARALLEL
        // std::execution::par tells the compiler: 
        // "You can split this loop across multiple CPU cores."
        std::for_each(std::execution::par, indices.begin(), indices.end(), 
            [&](int i) {
                // This lambda runs on multiple threads simultaneously.
                // Because 'i' is unique for every thread, 
                // we have NO Race Conditions on writing data.
                ProcessEntity(ecs, i, dt);
            }
        );
    }

private:
    // The logic is identical, but now thread-safe by design
    void ProcessEntity(ECSManager& ecs, int i, float dt) {
        if (ecs.hasPosition[i] && ecs.hasVelocity[i]) {
            // Read from Velocity (Safe)
            float vx = ecs.velocities[i].x;
            float vy = ecs.velocities[i].y;

            // Write to Position (Safe - no other thread touches index 'i')
            ecs.positions[i].x += vx * dt;
            ecs.positions[i].y += vy * dt;
        }
    }
};
```

### 5d. False Sharing

There's a hardware pitfall in the code above

- CPU Cores load memory in Cache Lines (64 bytes)
- `Position` struct is 8 bytes (`float x, y`)
- One Cache Line holds 8 Positions (`Pos[0]`-`Pos[7]`)

Possible scenario:
1. Core 1 tries to write to `Pos[0]`
2. Core 2 tries to write to `Pos[1]`
3. They are on the same Cache Line
4. The CPU cores fight over ownership of that cache line. The memory system has to "ping-pong" the cache line between cores
Result: Performance is worse than single-threaded code

To fix this, we're gonna do **chunking**. Instead of letting the library decide how to split the work, we explicitly divide our array into Chunks (or Blocks)

- Chunk Size: We pick a size (e.g., 1024 items) that is guaranteed to be larger than a Cache Line (64 bytes)
- The Logic: Thread 1 processes items `0`-`1023`. Thread 2 processes 1024 to 2047
The Result: They might fight over the one cache line at the very border (index 1023/1024), but the other 1023 items are processed at maximum speed with zero contention

```cpp {linenos=inline}
#include <execution>
#include <algorithm>
#include <vector>
#include <numeric>
#include <cmath>

class MovementSystem {
    // ... (Previous UpdateSerial code) ...

public:
    // 3. Multi-Threaded with CHUNKING (False Sharing Fix)
    void UpdateParallelChunked(ECSManager& ecs, float dt) {
        int totalEntities = ecs.positions.size();
        
        // STEP 1: Define a Chunk Size
        // A Cache Line is 64 bytes.
        // Position (8 bytes) + Velocity (8 bytes) = 16 bytes per entity.
        // 4 entities fill a cache line.
        // We choose 1024 to be extremely safe and reduce overhead.
        const int CHUNK_SIZE = 1024;

        // STEP 2: Calculate number of chunks needed
        // (Integer division ceiling trick: (A + B - 1) / B)
        int numChunks = (totalEntities + CHUNK_SIZE - 1) / CHUNK_SIZE;

        // Create a list of Chunk IDs: [0, 1, 2, ... numChunks-1]
        std::vector<int> chunkIDs(numChunks);
        std::iota(chunkIDs.begin(), chunkIDs.end(), 0);

        // STEP 3: Parallelize over CHUNKS, not Entities
        std::for_each(std::execution::par, chunkIDs.begin(), chunkIDs.end(), 
            [&](int chunkIndex) {
                
                // Calculate the range for this specific thread
                int start = chunkIndex * CHUNK_SIZE;
                
                // Ensure the last chunk doesn't go out of bounds
                int end = std::min(start + CHUNK_SIZE, totalEntities);

                // STEP 4: Process the Chunk (Serial Loop)
                // This thread now has exclusive access to this range of memory.
                // No other thread is writing to indices [start ... end].
                for (int i = start; i < end; ++i) {
                    ProcessEntity(ecs, i, dt);
                }
            }
        );
    }

private:
    void ProcessEntity(ECSManager& ecs, int i, float dt) {
        if (ecs.hasPosition[i] && ecs.hasVelocity[i]) {
            ecs.positions[i].x += ecs.velocities[i].x * dt;
            ecs.positions[i].y += ecs.velocities[i].y * dt;
        }
    }
};
```

# UE specific notes
## 1. `Tick()` problem

In Unreal, `Tick()` is the function that runs **every single frame**

Even an empty `Tick()` function has overhead. The engine has to iterate through a list of ticking actors, check if they are paused, check their tick group, and call the function

Imagine you have 1,000 enemies. Each one has a Blueprint with a Tick event checking "Is Player Close?"
- 1,000 checks x 60 FPS = 60,000 checks per second
- This logic runs on the **Game Thread**. If the Game Thread takes longer than 16.6ms, your FPS drops below 60

Ideally, disbable Tick by default (`PrimaryActorTick.bCanEverTick = false;`) and only enable it for actors that absolutely need continuous updates (like a homing missile/projectiles)

## 2. BP vs C++

Blueprints (BP) are a scripting language running on a Virtual Machine (VM)

- The Speed Difference: Depending on the complexity, raw C++ is roughly 10x to 100x faster than Blueprint logic
- The slowness comes from the "marshalling" overhead—calling a C++ function from BP requires the VM to translate data types back and forth

When to use which?

- Use C++ for:
  - Heavy math (Physics calculations, procedural generation)
  - `Tick()` logic (if you must tick)
  - Complex loops (looping 10,000 times in BP is suicide)
  - Core systems (Inventory, Health, Networking)
- Use BP for:
  - One-off events (OnOverlap, OnClicked)
  - Visuals (Timelines, spawning particles, playing sounds)
  - Level Design (referencing specific assets)

Ideally, the workflow should be like this;
- Expose a UFUNCTION(BlueprintImplementableEvent) called OnTakeDamageVisuals() in C++
- The C++ handles the math (subtracting HP), then calls the BP event so the designer can easily add a flash effect or sound without touching code

## 3. Event-driven architecture
Instead of checking "Is X happening?" every frame (Polling), wait for the engine to tell you "X happened" (Events)

**Bad (Polling in Tick):**
```cpp {linenos=inline}
void Tick(float DeltaTime) {
    // Running this every frame is wasteful
    if (GetDistanceTo(Player) < 100.0f) {
        Explode();
    }
}
```

**Event-Driven**:
```cpp {linenos=inline}
// Use a Collision Component (Sphere/Box). The physics engine is already checking overlaps efficiently using spatial partitioning (Octrees/BVH)

// In Constructor
SphereComp->OnComponentBeginOverlap.AddDynamic(this, &AMine::OnOverlap);

// Only runs ONCE when the player actually touches the sphere
void AMine::OnOverlap(...) {
    Explode();
}
```

## 4. Timers
If you need to check something periodically (e.g., "Regenerate Health"), do not use Tick. Use a Timer.

```cpp {linenos=inline}
GetWorldTimerManager().SetTimer(RegenHandle, this, &APlayer::RegenHealth, 1.0f, true);
```

This runs once per second, not 60 times per second. It removes the load from the critical frame loop

## 5. Significance Manager

Not all objects are equal. An enemy 5 meters away is "Significant." An enemy 500 meters away is "Insignificant.

How it works:
- You implement logic to lower the "Tick Rate" based on significance
  - Close: Tick every frame. High quality animation
  - Far: Tick every 10 frames. Disable animation updates. Use lower LOD (Level of Detail) meshes

Use Significance Manager to throttle the tick rate of distant entities, or simply disable their Tick entirely until they come within range

## 6. Cast vs Interface (Soft Reference)
This is about **Memory Management**

The Scenario: You have a `PlayerCharacter`. You want to interact with a `Chest`, a `Door`, and a `Lever`

1. Approach A: Casting (The "Hard Reference")
If you Cast, you tell the engine: "This Player class knows _about_ the Chest class"

```cpp {linenos=inline}
// Player.cpp
#include "Chest.h" // <--- HARD REFERENCE
#include "Door.h"  // <--- HARD REFERENCE

void APlayer::Interact(AActor* Target) {
    // Try to cast to Chest
    AChest* Chest = Cast<AChest>(Target);
    if (Chest) {
        Chest->Open();
        return;
    }

    // Try to cast to Door
    ADoor* Door = Cast<ADoor>(Target);
    if (Door) {
        Door->Open();
        return;
    }
}
```

When you load `Player.uasset` (or spawn the C++ class), the engine sees the `#include "Chest.h"`. It says "I need to load the Chest class to know what it is"
- The Chest class references a `Gold Texture`
- The Chest class references a `Wood Sound`
Just spawning the Player loads the Chest, the Door, the Gold Texture, and the Wood Sound into RAM. Even if there is no chest in the level...

2. Approach B: Interfaces (The "Decoupled" Solution)
An Interface is a contract. "I promise I have a function called `OnInteract()`." The Player doesn't care who implements it

Step 1: Define the Interface
```cpp {linenos=inline}
// InteractInterface.h
#pragma once
#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "InteractInterface.generated.h"

UINTERFACE(MinimalAPI)
class UInteractInterface : public UInterface { GENERATED_BODY() };

class IInteractInterface {
    GENERATED_BODY()
public:
    // BlueprintNativeEvent allows both C++ and BP to override this
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable)
    void OnInteract();
};
```

Step 2: Implement in Objects
```cpp {linenos=inline}
// Chest.h
class AChest : public AActor, public IInteractInterface {
    // ...
    virtual void OnInteract_Implementation() override {
        OpenChestLogic();
    }
};
```

Step 3: Call it from Player (No Casting!)
```cpp {linenos=inline}
// Player.cpp
#include "InteractInterface.h" // Only includes the lightweight interface

void APlayer::Interact(AActor* Target) {
    // Check if the target implements the interface
    if (Target && Target->Implements<UInteractInterface>()) {
        
        // Execute the function. 
        // We don't know if it's a Chest or a Door. We don't care.
        IInteractInterface::Execute_OnInteract(Target);
    }
}
```

The Result:
- The Player class does not know `Chest.h` exists
- Loading the Player does not load the Chest textures/sounds
- You save memory usage and reduce load times

Prefer Interfaces for interaction systems to avoid creating hard reference chains. This ensures that loading the Player character doesn't accidentally load every interactive object in the entire game into memory

## 7. UE's UObject `Cast<T>`
### 7a. The Problem: `dynamic_cast` vs `Cast<T>`
In standard C++, `dynamic_cast` relies on RTTI (Run-Time Type Information)
- Pros: Safe. Returns nullptr if the cast fails
- Cons: Slow. It has to traverse the inheritance tree at runtime
- Unreal: Disables RTTI by default for performance. Therefore, `dynamic_cast` doesn't work on `UObjects` in the standard way

Unreal created its own reflection system to handle this

### 7b. How `Cast<T>` Works (The Two-Step Process)
When you call `Cast<AMyActor>(Obj)`, Unreal does two checks:

Step A: The Fast Path (Class Cast Flags)

For core engine classes (Actor, Pawn, Character, StaticMeshComponent, etc.), Unreal doesn't even look at the inheritance tree. It checks a **Bitmask**

Every class has a `ClassCastFlags` integer.
- `CASTCLASS_AActor`
- `CASTCLASS_APawn`

```cpp {linenos=inline}
// Pseudo-code of what happens inside Cast<>
if (Object->GetClass()->HasAnyCastFlag(TCastFlags<TargetType>::Value)) {
    return (TargetType*)Object;
}
```

Cost: Bitwise AND, extremely fast

Step B: The Generic Path (`IsA` / `IsChildOf`)

If you are casting to a custom class (e.g., `AMyGameHero`) that doesn't have a dedicated engine flag, Unreal calls `IsA<T>()`, which calls `IsChildOf()`

This is where the O(1) magic happens

### 7c. Performance difference in Editor vs. Shipping
The implementation of `IsChildOf` changes depending on your build configuration

In Editor Builds (`UE_EDITOR = 1`)
The engine assumes classes might change at runtime (Hot Reload / Live Coding)

- Algorithm: It walks up the inheritance tree
  - Check this. Is it Target? No
  - Check Super. Is it Target? No
  - Check Super->Super. Is it Target? Yes

Complexity: O(Depth). The deeper your hierarchy, the slower the cast

In Shipping/Game Builds (`UE_EDITOR = 0`)

The engine knows the class hierarchy is immutable (baked). It generates a `StructBaseChainArray` for every class

Concept: Every class holds an array of pointers to all its parents
Algorithm:
- Get the depth of the Target Class (e.g., Depth 3)
- Check if `MyClass.StructBaseChainArray[3] == TargetClass`

Complexity: O(1). Constant time. It doesn't matter if the inheritance depth is 2 or 50; it is a single array lookup

### 7d. Other Cast Types
- `CastChecked<T>`
  - Behavior: Casts the object. If it fails, Crashes the game (Asserts)
  - Performance: In Shipping builds, this compiles down to a raw C-style cast. It is effectively free
  - Usage: Use this when you are 100% sure of the type (e.g., inside `BeginPlay` after spawning a specific blueprint)

- `ExactCast<T>`
  - Behavior: Checks if the object is exactly that class (not a child)
  - Logic: `Object->GetClass() == T::StaticClass()`
  - Performance: Always O(1)

So, `Cast<T>` is _not_ always expensive. It depends on the build configuration
1. Fast Path: If casting to common engine classes like `AActor`, it uses a **Bitmask** check, which is instant
2. Generic Path: For custom classes, in the Editor, it walks the inheritance tree (O(Depth)). However, in Shipping builds, Unreal uses a cached `StructBaseChainArray` to perform the lookup in O(1) constant time

## 8. Modular Architecture

Unreal Engine is a collection of Modules (`Core`, `Engine`, `AIModule`, etc.). Your game should be too