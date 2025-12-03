---
title: "TNonNullPtr: UE's bouncer for null pointers!"
date: "2025-11-08"
description: "This article showcases TNonNullPtr, a lightweight container that provides guardrails for nullptr values"
hideHeader: true
hideBackToTop: true
hidePagination: true
readTime: true
autonumber: false
math: true
tags: ["ue", "c++"]
showTags: false
---

# Introduction

If you've spent any time writing gameplay code in Unreal's C++, you know the routine. The code we all have to write. 

Before you can safely use a pointer, you have to check it. This defensive habit is essential for preventing crashes, but it often leads to code that looks like this:

```cpp {linenos=inline style=vim}
void AMyGameMode::StartRound(const AController* PlayerController)
{
	if (PlayerController)
	{
		if (PlayerController->GetPawn<AMyCharacter>())
		{
			if (PlayerController->GetPawn<AMyCharacter>()->GetMyWeaponComponent())
			{
				PlayerController->GetPawn<AMyCharacter>()->GetMyWeaponComponent()->EquipWeapon();
			}
		}
	}
}
```
This code is safe, perfectly fine. But it's not clean. The core intent is buried under layers of validation. What if... we could flip this pattern on its head?

Instead of defensively checking for nulls _inside_ our functions, what if we... could enforce a rule that a pointer is __never__ null when it arrives?

# Meet the bouncer - `TNonNullPtr`
Think of `TNonNullPtr` as a bouncer at a club. Its job is simple, but important. Here's its code of conduct:

1. I do not __own__ the people in the club. My job is just to check them (Non-owning)
2. I check everyone's ID at the door (Non-null guarantee)
3. If someone shows up with an invalid ID (`nullptr`), I don't let them in. I stop them right there, right now (Asserts on creation)

`TNonNullPtr` essentially is a lightweight wrapper that makes a powerful promise: __this pointer is valid__.

## Two layers of protection; compile-time and runtime
`TNonNullPtr` provides two levels of security by cleverly using C++ features. Let's look at the engine code to see how.

1. The compile-time guard rail
For blatant mistakes, `TNonNullPtr` won't even let you compile. In `NonNullPointer.h`, the constructor and assignment operator for `nullptr` are explicitly forbidden using a `static_assert` trick.

```cpp {linenos=inline}
	/**
	 * nullptr constructor - not allowed.
	 */
	UE_FORCEINLINE_HINT TNonNullPtr(TYPE_OF_NULLPTR)
	{
		// Essentially static_assert(false), but this way prevents GCC/Clang from crying wolf by merely inspecting the function body
		static_assert(sizeof(ObjectType) == 0, "Tried to initialize TNonNullPtr with a null pointer!");
	}

    /**
	 * Assignment operator taking a nullptr - not allowed.
	 */
	inline TNonNullPtr& operator=(TYPE_OF_NULLPTR)
	{
		// Essentially static_assert(false), but this way prevents GCC/Clang from crying wolf by merely inspecting the function body
		static_assert(sizeof(ObjectType) == 0, "Tried to assign a null pointer to a TNonNullPtr!");
		return *this;
	}
```

The `static_assert(sizeof(ObjectType) == 0, ...)` is a common technique. 

Since no complete type can have a size of zero, this assertion is guaranteed to fail if the compiler ever tries to generate code for these functions. It only tries to do that when it sees you directly using nullptr.

This is why this code fails to compile:
```cpp {linenos=inline style=vim}
void AMyCharacter::BeginPlay()
{
	Super::BeginPlay();
	
	TNonNullPtr<AActor> SomeActor = nullptr;
}
```

```
0>[1/6] Compile [x64] MyCharacter.cpp
0>NonNullPointer.h(40,36): Error C2338 : static_assert failed: 'Tried to initialize TNonNullPtr with a null pointer!'
0>		static_assert(sizeof(ObjectType) == 0, "Tried to initialize TNonNullPtr with a null pointer!");
0>		                                 ^
0>NonNullPointer.h(40,36): Reference  : the template instantiation context (the oldest one first) is
0>MyCharacter.cpp(23,22): Reference  : see reference to class template instantiation 'TNonNullPtr<AActor>' being compiled
0>	TNonNullPtr<AActor> SomeActor = nullptr;
0>	                    ^
0>NonNullPointer.h(37,2): Reference  : while compiling class template member function 'TNonNullPtr<AActor>::TNonNullPtr(TYPE_OF_NULLPTR)'
0>	UE_FORCEINLINE_HINT TNonNullPtr(TYPE_OF_NULLPTR)
0>	^
0>MyCharacter.cpp(23,32): Reference  : see the first reference to 'TNonNullPtr<AActor>::TNonNullPtr' in 'AMyCharacter::BeginPlay'
0>	TNonNullPtr<AActor> SomeActor = nullptr;
```

The compiler sees the `nullptr` and gives you an error, directly telling where the mistake is, acting as a guard rail before your code even run.

2. The runtime bouncer
But what about cases the compiler can't predict? Perhaps a `nullptr` Player State? A `nullptr` due to other function call failing to return a valid pointer?

The constructor that takes a regular pointer uses `ensureMsgf` to validate it.

```cpp {linenos=inline}
    /**
	 * Constructs a non-null pointer from the provided pointer. Must not be nullptr.
	 */
	inline TNonNullPtr(ObjectType* InObject)
		: Object(InObject)
	{
		ensureMsgf(InObject, TEXT("Tried to initialize TNonNullPtr with a null pointer!"));
	}
```

This is the bouncer. When your code runs and a variable that happens to be `nullptr` gets passed in, the `ensureMsgf` fires.

```cpp {linenos=inline style=vim}
void AMyCharacter::BeginPlay()
{
	Super::BeginPlay();
	
	AMyGameMode* MyFoundActor = Cast<AMyGameMode>(UGameplayStatics::GetActorOfClass(this, AMyGameMode::StaticClass()));
	TNonNullPtr<AMyGameMode> MyGameMode = MyFoundActor;

	MyGameMode->StartRound(GetController());
}
```

This triggers the exception if you're currently running your project with a debugger attached, where you can inspect the stack trace.

![Runtime exception](/posts/tnonnullptr/runtime_exception.png "Whoop, you just got caught!")

And then inside the output log, you'll see the following message
```
LogOutputDevice: Warning: Script Stack (0 frames) :
LogOutputDevice: Error: Ensure condition failed: InObject [File:C:\UE_5.7\Engine\Source\Runtime\Core\Public\Templates\NonNullPointer.h] [Line: 49] 
Tried to initialize TNonNullPtr with a null pointer!
LogStats:             FDebug::EnsureFailed -  0.000 s
LogOutputDevice: Warning: Script Stack (0 frames) :
LogOutputDevice: Error: Ensure condition failed: Object [File:C:\UE_5.7\Engine\Source\Runtime\Core\Public\Templates\NonNullPointer.h] [Line: 210] 
Tried to access null pointer!

```

Very handy for catching bugs during development!

So, you get the best of both worlds; compile-time errors for obvious bugs and runtime checks for the _sneaky_ ones.

# Well then, why isn't this everywhere?

You're probably wondering, if this is so great, why isn't it the default even for gameplay code?

The reasons are... a mix of game development pragmatism and engine architecture.

1. In gameplay, `nullptr` is often a valid state

In low-level engine code, a null pointer often signifies a critical logic error. But in the fluid world of gameplay, `nullptr` is a crucial and expected piece of information.

- Optional components, an actor that happens to trigger `OnBeginOverlap()` might have `UMyWeaponComponent`, but it's not always guaranteed.
- Searching for hit actors, a line trace that hits nothing should return `nullptr`
- Casting should return `nullptr` if the cast fails due to it being a different type or the pointer itself is invalid.

In these cases, `nullptr` isn't a bug. Rather, they're a state that drives a game logic. Using `TNonNullPtr` here would be incorrect because it would raise an exception on a perfectly valid game state occurances.

2. `check()` and `ensure()` are the pragmatic soltion

As established before, the primary benefit of `TNonNullPtr` is the immediate assert. For gameplay programmers, we already have a way that acheive the same goal with more flexibility.

- `check(Pointer != nullptr);`, functionally the same as `TNonNullPtr`'s constructor. It crashes with a clear call stack if the pointer is null, enforcing a hard contract.
- `ensure(Pointer != nullptr);` often preferred in development builds. It logs an error with a call stack but _doesn't_ crash it. Perfect for catching "shouldn't-happen-but-might" bugs without ruining a playtest session.

Adding a single line of `check()` or `ensure()` line at the top of a function is far more ergonomic and compatible than changing a type signature.

# The mind-shift, with `TNonNullPtr` 'spirit'
Let's see how this mindset cleans up a real-world piece of logic

__Before: Defensive and paranoid__
```cpp {linenos=inline}
// This function must constantly worry about its input.
void UMyWeaponComponent::ChangeWeapon(UWeapon* NewWeapon)
{
	if (!NewWeapon)
	{
		UE_LOG(LogTemp, Warning, TEXT("Weapon is null"));
		return; // Early exit, logic flow is split.
	}

	// Okay, it's not null, so we can do stuff.
	NewWeapon->SetAmmo(100);
}
```

__After: Contractual and confident__
```cpp {linenos=inline}
// This function now demands a valid weapon. The _caller_ is responsible for ensuring that the weapon is valid.
void UMyWeaponComponent::ChangeWeapon(AWeapon* NewWeapon)
{
	// The "bouncer" checks the ID at the door.
	checkf(NewWeapon, TEXT("NewWeapon is null"));

	// No more nested ifs! The code is linear, cleaner and easier to read.
	NewWeapon->SetAmmo(100);
}

// The calling code now is forced to be correct.
void AMyCharacter::NotifyActorBeginOverlap(AActor* OtherActor)
{
	Super::NotifyActorBeginOverlap(OtherActor);

	if (AWeapon* Weapon = Cast<AWeapon>(OtherActor))
	{
		MyWeaponComponent->ChangeWeapon(Weapon);
	}
	else
	{
		// We can handle the error here at the source, instead of passing the problem downstream.
		UE_LOG(LogTemp, Error, TEXT("AMyCharacter::NotifyActorBeginOverlap called with non-weapon actor %s"), *OtherActor->GetName());
	}
}
```

# Conclusion
You will likely never use `TNonNullPtr` in your gameplay code, and that's perfectly OK. Its true value lies in the lesson it teaches; __make your code's intentions clear__.

- It provides both compile-time guard rails and runtime checks
- It shifts the responsibility for nulls to the _caller_, where it often belongs
- It turns silent, hard-to-trace crashes into loud, easy-to-fix errors

So next time you write a piece of function, hire a bouncer. Even if it's just a simple `check()` at the door. Your future self will thank you.

# Acknowledgments
A special thank you to [apokrif6](https://github.com/apokrif6)! 

I was first inspired to dig into this topic after reading their excellent article, [TNonNullPtr — Non-Nullable Raw Pointers in Unreal Engine](https://apokrif6.github.io/2025/10/22/tnonnullptr-in-unreal-engine.html). 

I highly recommend it for a quick, scannable reference guide, especially its fantastic "When to use it?" table.

----
Thanks for reading, hope it helps and useful for you. See you next time!