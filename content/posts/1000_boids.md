---
title: "Simulating 1000 flocking fish in Unreal Engine"
date: "2025-11-11"
description: "A step-by-step account of optimizing a boids flocking simulation in Unreal Engine, from an initial actor-based implementation to a data-oriented, parallelized, and GPU-accelerated system."
hideHeader: true
hideBackToTop: true
hidePagination: true
readTime: true
autonumber: true
math: true
tags: ["dod", "ue", "c++", "boids", "performance", "optimization"]
showTags: false
---
# Introduction
Simulating the flocking behavior of birds or the schooling of fish is a classic problem in computer graphics. The Boids algorithm, created by [Craig Reynolds](https://www.red3d.com/cwr/) in 1986, offers a powerful solution. It demonstrates how complex, life-like group motion can emerge from individuals following a few simple rules, without any central leader or complex choreography.

This principle offers a way to add life to game worlds. A common application is simulating a school of fish, but a significant technical challenge arises when scaling up to large numbers. The target here was to effectively simulate a school of 1000 fish, moving as one cohesive unit while still allowing for individual interaction.

The initial implementation used a standard Unreal Engine approach: an `AActor_Fish` class with the basic boids logic in its `Tick` function. When spawning 1000 instances, the result was a slideshow. Performance cratered to around 6 FPS.

This post outlines my step-by-step journey, taking that simulation from a crawl to a fluid 70+ FPS. We'll cover profiling, shifting from a object-oriented setup to a data-oriented design, and leveraging Unreal Engine's features for parallel processing and GPU acceleration, all while maintaining the crucial gameplay feature of selecting and catching a single fish from the crowd.

For context, the starting point is a common actor-based approach where each fish is an `AActor_Fish` instance managing its own state. This caused performance issues due to actor ticking overhead and inefficient neighbor searches. Through successive passes, these were addressed, keeping the ability to interact with individual fish intact.

All tests were conducted on a machine with a Ryzen 5950X 16-core CPU, 128GB DDR4-3200 memory, and an RTX 3070 Ti GPU. To establish a fair baseline, measurements were taken in standalone mode in DebugGame configuration with the Rider debugger attached. This provides a conservative estimate. If the simulation performs well under these conditions, it will run even smoother in optimized shipping builds.

![Preview](/posts/1000_boids/preview.gif)

# The Gameplay Loop: Catching a Fish in a Sea of Data
Before covering phases, it's crucial to understand the core gameplay loop handled by `UActorComponent_FishingComponent`. This loop coordinates player input, animations, UI, and the fish simulation itself. The main challenge at scale is to perform steps like "Find the nearest fish" and "Control a single fish" without stalling the entire system.

{{< mermaid >}}
sequenceDiagram
    participant Player
    participant FishingComponent
    participant AnimBP as Animation Blueprint
    participant FishSim as Fish Simulation
    participant TargetFish as Targeted Fish

    Player->>FishingComponent: Hold LMB (OnCastAction)
    loop Charging Cast
        FishingComponent->>FishingComponent: Update Decal & Cast Power
        FishingComponent->>Player: Broadcast UI Progress
    end
    Player->>FishingComponent: Release LMB (OnCastActionEnded)
    FishingComponent->>AnimBP: Play "Throw" Animation
    Note right of AnimBP: Animation plays...
    AnimBP-->>FishingComponent: AnimNotify: LaunchBobber
    Note left of FishingComponent: Bobber flies and lands...
    FishingComponent->>FishingComponent: OnBobberLandsOnWater()
    FishingComponent->>FishSim: FindNearestFish(Location)
    FishSim-->>FishingComponent: Return Fish Index
    FishingComponent->>FishSim: PromoteBoidToActor(Index)
    FishSim-->>FishingComponent: Return Spawned Actor (TargetFish)
    
    Note over FishingComponent, TargetFish: Bite timer starts...
    
    alt Player Reels In Successfully
        Player->>FishingComponent: Click LMB (After Bite)
        FishingComponent->>TargetFish: ReeledIn()
        TargetFish->>TargetFish: Move towards player
        Player->>FishingComponent: Click LMB again
        FishingComponent->>TargetFish: Catch()
        TargetFish->>TargetFish: Attach to rod
    else Player Reels In Too Early
        Player->>FishingComponent: Click LMB (Before Bite)
        FishingComponent->>TargetFish: Escape()
        TargetFish->>TargetFish: Flee and despawn
    end
{{< /mermaid >}}

Here's a breakdown of the steps shown in the diagram:
1.  **Charging The Cast:** The player holds LMB. The `OnCastAction` delegate in the `FishingComponent` calculates the cast distance and updates a target decal on the water.
2.  **Casting:** Releasing LMB triggers `OnCastActionEnded`, which tells the animation blueprint to play a "throw" animation.
3.  **The Bobber Flies:** An anim notify within the throw animation sends a message back to the `FishingComponent` to launch the bobber projectile.
4.  **Finding The Fish:** When the bobber lands, `OnBobberLandsOnWater` is called. This is a critical step: it queries the `FishManager` (our simulation) to find the nearest fish data point. The manager then "promotes" this data point into a full `AActor_Fish` for interaction.
5.  **The Bite:** A timer starts. When it ends, the newly spawned fish actor is "hooked." Its simulation logic is overridden, and it begins moving toward the bobber.
6.  **Reeling In:** Clicking LMB *after* the bite successfully catches the fish. Clicking *before* the bite causes it to escape, and the actor is "demoted" back into a data point in the simulation.


In code, this uses interfaces like `ICatchableInterface`, implemented by `AActor_Fish`. When selected, the fish's `bBeingTargeted` flag disables flocking and enables timeline-based movement.

The `UActorComponent_FishingComponent` manages states, timers, and interactions between the player, rod (`ICatcherInterface`), and fish.

Here's the casting handling in `UActorComponent_FishingComponent`:
```cpp {linenos=inline}
void UActorComponent_FishingComponent::OnCastAction(const float& InElapsedTime)
{
    if (CurrentFishingState != FFishingTags::Get().FishingComponent_State_Idling) return;

    DetermineCastLocation(InElapsedTime);
    AttemptToCast(InitialActorLocation + InitialActorForwardVector * 100.f);

    const float Progress = GetMappedElapsedTimeToMaximumCastTime(InElapsedTime);
    BroadcastUIMessage(Progress);
}
void UActorComponent_FishingComponent::OnCastActionEnded(const float& InElapsedTime)
{
    ToggleDecalVisibility(false);

    if (CurrentFishingState != FFishingTags::Get().FishingComponent_State_Idling) return;
    CurrentFishingState = FFishingTags::Get().FishingComponent_State_Casting;

    UVAGameplayMessagingSubsystem::Get(this).BroadcastMessage(this, FFishingTags::Get().Messaging_Fishing_AnimInstance_StateChange, FFishingTags::Get().AnimInstance_Fishing_State_Casting);
}
```
When the bobber lands, it searches for the nearest fish:
```cpp {linenos=inline}
void UActorComponent_FishingComponent::OnBobberLandsOnWater(const FVector& InBobberLandsOnWaterLocation)
{
    if (CurrentFishingState != FFishingTags::Get().FishingComponent_State_Casting) return;
    CurrentFishingState = FFishingTags::Get().FishingComponent_State_WaitingForFish;

    MockBobberLandsOnWaterDelegate.Broadcast(0.f);

    AttemptGetNearestCatchable();
}
```
The fish interaction via `ICatchableInterface` in `AActor_Fish`:
```cpp {linenos=inline}
void AActor_Fish::ReeledIn(const FVector& RodLocation)
{
    bBeingTargeted = true;
    Velocity = FVector::ZeroVector;
    ReelInLocation = RodLocation;
    LookAtReelInRotation = UKismetMathLibrary::FindLookAtRotation(GetActorLocation(), ReelInLocation);

    ReeledInTimeline.PlayFromStart();
}
void AActor_Fish::Escape()
{
    ReeledInTimeline.Stop();

    Velocity = FVector::ZeroVector;
    EscapeRotation = UKismetMathLibrary::FindLookAtRotation(GetActorLocation(), InitialActorLocation);

    EscapeTimeline.PlayFromStart();
}
void AActor_Fish::Catch(USceneComponent* InCatchingRod)
{
    if (!InCatchingRod) return;
    bBeingTargeted = true;

    Velocity = FVector::ZeroVector;

    AttachToComponent(InCatchingRod, FAttachmentTransformRules::SnapToTargetIncludingScale, NAME_None);
}
```
The component mediates the reel-in:
```cpp {linenos=inline}
void UActorComponent_FishingComponent::ReelInCurrentCatchable()
{
    if (!CurrentCatchable) return;
    if (!CurrentCatcher) return;
    CurrentCatchable->Catch(CurrentCatcher->GetCatcherAttachComponent());

    CurrentFishingState = FFishingTags::Get().FishingComponent_State_ReelingIn;
    UVAGameplayMessagingSubsystem::Get(this).BroadcastMessage(this, FFishingTags::Get().Messaging_Fishing_AnimInstance_StateChange, FFishingTags::Get().AnimInstance_Fishing_State_ReelingIn);
}
```
This setup supports integration between player input, animations, and fish behavior.

# What Are Boids, Anyway?
The Boids algorithm is a classic in the world of artificial life, first presented by Craig Reynolds in 1987 at the SIGGRAPH conference. [His paper](https://www.cs.toronto.edu/~dt/siggraph97-course/cwr87/), "Flocks, Herds, and Schools: A Distributed Behavioral Model," was revolutionary. Instead of programming a complex central brain to command the flock, Reynolds proposed that intricate, life-like motion could emerge from each individual "boid" (a portmanteau of "bird-oid object") following three simple, local rules.

These rules only require a boid to consider its immediate neighbors, not the entire flock. This decentralized approach is what makes the simulation so powerful and, as we'll see, presents its primary performance challenge. The three original rules are:
1. **Separation**: Steer to avoid crowding local flockmates.
2. **Alignment**: Steer towards the average heading of local flockmates.
3. **Cohesion**: Steer to move toward the average position (center of mass) of local flockmates.

{{< threejs id="boids-rules-viz" scene="boids-rules" >}}

When translated into code, these three rules, along with a fourth one for boundary containment, form the core of our simulation logic. In the initial `AActor_Fish` class, these were applied every frame in `Tick` function.

### The Core `Tick` Logic (Baseline)
Each fish processed this logic independently.
```cpp {linenos=inline}
void AActor_Fish::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    Flock(DeltaSeconds); // Contains all boids logic
    TickTimelines(DeltaSeconds); // For player interaction
}
void AActor_Fish::Flock(float DeltaSeconds)
{
    if (bBeingTargeted || DeltaSeconds == 0.f) return;

    // 1. Find Neighbors (The bottleneck!)
    TArray<AActor_Fish*> Neighbors;
    GetNeighbors(Neighbors);

    // 2. Calculate the total steering force from all rules
    const FVector SteeringForce = CalculateFlockForce(Neighbors);

    // 3. Apply force to velocity (simple Euler integration)
    Velocity += SteeringForce * DeltaSeconds;
    Velocity = Velocity.GetClampedToMaxSize(MaxSpeed);

    // 4. Update the actor's transform
    const FVector NewLocation = GetActorLocation() + Velocity * DeltaSeconds;
    const FRotator TargetRotation = Velocity.ToOrientationRotator();
    const FRotator InterpolatedRotation = FMath::RInterpTo(GetActorRotation(), TargetRotation, DeltaSeconds, 10.0f);
    SetActorLocationAndRotation(NewLocation, InterpolatedRotation);
}
FVector AActor_Fish::CalculateFlockForce(const TArray<AActor_Fish*>& Neighbors) const
{
    if (bBeingTargeted) return FVector::ZeroVector;

    const FVector FCohesion = Cohesion(Neighbors) * CohesionWeight;
    const FVector FSeparation = Separation(Neighbors) * SeparationWeight;
    const FVector FAlignment = Alignment(Neighbors) * AlignmentWeight;
    const FVector FBoundary = BoundaryContainment() * ContainmentWeight;
   
    FVector TotalForce = FCohesion + FSeparation + FAlignment + FBoundary;
    return TotalForce.GetClampedToMaxSize(MaxForce);
}
```
The three core boids rules were implemented as follows:
```cpp {linenos=inline}
FVector AActor_Fish::Separation(const TArray<AActor_Fish*>& Neighbors) const
{
    FVector RepulsionAccumulator = FVector::ZeroVector;

    int32 Count = 0;
    const float DistSqThreshold = FMath::Square(SeparationDistance);
    for (const AActor_Fish* Other : Neighbors)
    {
        FVector Difference = GetActorLocation() - Other->GetActorLocation();
        float DistSq = Difference.SizeSquared();
        if (DistSq > 0 && DistSq < DistSqThreshold)
        {
            RepulsionAccumulator += Difference.GetSafeNormal() / FMath::Sqrt(DistSq);
            Count++;
        }
    }

    if (Count > 0)
    {
        RepulsionAccumulator /= Count;
        if (!RepulsionAccumulator.IsNearlyZero()) {
            FVector TargetVel = RepulsionAccumulator.GetSafeNormal() * MaxSpeed;
            return Steer(TargetVel);
        }
    }

    return FVector::ZeroVector;
}
FVector AActor_Fish::Alignment(const TArray<AActor_Fish*>& Neighbors) const
{
    FVector AvgVelocity = FVector::ZeroVector;
    int32 AlignCount = 0;

    for (const AActor_Fish* Fish : Neighbors)
    {
        if (Fish->GetFlockGroupID() == GetFlockGroupID())
        {
            AvgVelocity += Fish->Velocity;
            AlignCount++;
        }
    }

    if (AlignCount > 0)
    {
        AvgVelocity /= AlignCount;
        return Steer(AvgVelocity);
    }

    return FVector::ZeroVector;
}
FVector AActor_Fish::Cohesion(const TArray<AActor_Fish*>& Neighbors) const
{
    FVector CenterOfMass = FVector::ZeroVector;
    int32 CohesionCount = 0;

    for (const AActor_Fish* Fish : Neighbors)
    {
        if (Fish->GetFlockGroupID() == GetFlockGroupID())
        {
            CenterOfMass += Fish->GetActorLocation();
            CohesionCount++;
        }
    }

    if (CohesionCount > 0)
    {
        CenterOfMass /= CohesionCount;
        return Steer(CenterOfMass - GetActorLocation());
    }

    return FVector::ZeroVector;
}
```
The `Steer` function, common to all rules, computes the steering force toward a desired velocity:
```cpp {linenos=inline}
FVector AActor_Fish::Steer(const FVector& Target) const
{
    if (MaxSpeed <= 0.0f || MaxForce <= 0.0f) return FVector::ZeroVector;

    FVector DesiredVelocity = Target;
    if (!DesiredVelocity.IsNearlyZero())
    {
        DesiredVelocity = DesiredVelocity.GetClampedToSize(0.0f, MaxSpeed);
    }

    FVector Steering = DesiredVelocity - Velocity;
    if (Steering.SizeSquared() <= FMath::Square(MaxForce)) return Steering;

    Steering = Steering.GetClampedToMaxSize(MaxForce);
    return Steering;
}
```
Additionally, a boundary containment rule keeps fish within their spawn area:
```cpp {linenos=inline}
FVector AActor_Fish::BoundaryContainment() const
{
    const FVector Location = GetActorLocation();
    const FVector BoxMin = ContainingSpawnAreaCenter - ContainingSpawnAreaBoxExtent;
    const FVector BoxMax = ContainingSpawnAreaCenter + ContainingSpawnAreaBoxExtent;
    FVector Force = FVector::ZeroVector;

    auto CalculateAxisRepulsion = [&](float CurrentPos, float MinPos, float MaxPos, float CheckDist, float& OutForceComponent)
    {
        const float DistToMin = CurrentPos - MinPos;
        const float DistToMax = MaxPos - CurrentPos;
        float Strength = 0.0f;
        if (DistToMin < CheckDist)
        {
            Strength = 1.0f - (DistToMin / CheckDist);
            OutForceComponent += FMath::Lerp(0.0f, MaxForce, Strength);
        }
        else if (DistToMax < CheckDist)
        {
            Strength = 1.0f - (DistToMax / CheckDist);
            OutForceComponent -= FMath::Lerp(0.0f, MaxForce, Strength);
        }
        if (CurrentPos < MinPos || CurrentPos > MaxPos)
        {
            OutForceComponent = (CurrentPos < MinPos) ? MaxForce : -MaxForce;
        }
    };

    CalculateAxisRepulsion(Location.X, BoxMin.X, BoxMax.X, ContainmentCheckDistance, Force.X);
    CalculateAxisRepulsion(Location.Y, BoxMin.Y, BoxMax.Y, ContainmentCheckDistance, Force.Y);
    CalculateAxisRepulsion(Location.Z, BoxMin.Z, BoxMax.Z, ContainmentCheckDistance, Force.Z);
    return Force;
}
```
The logic was functional, but performance needed improvement. The main issue was in `GetNeighbors`.

# The Starting Point: The Actor-Based O(N²) Approach
The `GetNeighbors` function was the primary bottleneck.
    
{{< threejs id="on2-viz" scene="on2-problem" >}}


```cpp {linenos=inline}
void AActor_Fish::GetNeighbors(TArray<AActor_Fish*>& OutNeighbors) const
{
    OutNeighbors.Empty();

    const UWorld* World = GetWorld();
    if (!World) return;

    TArray<AActor*> FoundActors;
    // The main offender: iterating all actors for every single fish.
    UGameplayStatics::GetAllActorsOfClass(World, StaticClass(), FoundActors);
   
    const FVector CurrentLocation = GetActorLocation();
    const float RadiusSquared = FMath::Square(NeighborRadius);
    for (AActor* Actor : FoundActors)
    {
        if (Actor == this) continue;
        AActor_Fish* Fish = Cast<AActor_Fish>(Actor);

        if (!Fish || Fish->bBeingTargeted) continue;
        if (FVector::DistSquared(CurrentLocation, Fish->GetActorLocation()) > RadiusSquared) continue;

        OutNeighbors.Add(Fish);
    }
}
```
For 1000 fish, this resulted in approximately 1,000,000 iterations per frame due to repeated actor list scans.

Profiling showed `GetAllActorsOfClass` taking most CPU time, as it scans the full actor list each time. Distance checks contributed to the quadratic O(N²) complexity for neighbor queries.
![Baseline Profile](/posts/1000_boids/baseline_profile_a.png)

![Baseline Profile](/posts/1000_boids/baseline_profile_b.png)


**The Result:** Straightforward to implement, but led to significant performance issues. 6 FPS Max.
![Baseline Result](/posts/1000_boids/baseline.png)

# Step 1: Implementing a Spatial Grid
A spatial hash grid divides space into cells.

{{< threejs id="spatial-grid-viz" scene="spatial-grid" >}}

This was added in `UTickableWorldSubsystem_FishManager`.

The manager tracks fish instances.
```cpp {linenos=inline}
// In AActor_Fish.h
virtual void BeginPlay() override;
virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
// In AActor_Fish.cpp
void AActor_Fish::BeginPlay()
{
    Super::BeginPlay();

    if (const UWorld* World = GetWorld())
    {
        if (UTickableWorldSubsystem_FishManager* FishManager = World->GetSubsystem<UTickableWorldSubsystem_FishManager>())
        {
            FishManager->RegisterFish(this);
        }
    }
}
void AActor_Fish::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    if (const UWorld* World = GetWorld())
    {
        if (UTickableWorldSubsystem_FishManager* FishManager = World->GetSubsystem<UTickableWorldSubsystem_FishManager>())
        {
            FishManager->UnregisterFish(this);
        }
    }

    Super::EndPlay(EndPlayReason);
}
```
The `FishManager` stores actors and updates the grid in its `Tick`.
```cpp {linenos=inline}
UCLASS()
class FISHINGFEATURE_API UTickableWorldSubsystem_FishManager : public UTickableWorldSubsystem
{
GENERATED_BODY()
public:
virtual void Tick(float DeltaTime) override;
// ...
void RegisterFish(AActor_Fish* InFishActor);
void UnregisterFish(AActor_Fish* InFishActor);
void FindNeighborsInRadius(const AActor_Fish* InFishActor, int32 InRadius, TArray<AActor_Fish*>& OutNeighbors) const;
private:
void UpdateSpatialGrid();
UPROPERTY(Transient)
TArray<AActor_Fish*> AllFish;
TMap<FIntVector, TArray<AActor_Fish*>> SpatialGrid;
float CellSize = 1000.0f;
};
```
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    UpdateSpatialGrid(); // Rebuild the grid every frame with the latest fish positions
}
void UTickableWorldSubsystem_FishManager::RegisterFish(AActor_Fish* InFishActor)
{
    if (IsValid(InFishActor)) AllFish.Add(InFishActor);
}
void UTickableWorldSubsystem_FishManager::UnregisterFish(AActor_Fish* InFishActor)
{
    if (IsValid(InFishActor)) AllFish.Remove(InFishActor);
}
void UTickableWorldSubsystem_FishManager::UpdateSpatialGrid()
{
    SpatialGrid.Reset();

    for (AActor_Fish* Fish : AllFish)
    {
        if (!IsValid(Fish)) continue;

        const FVector& Position = Fish->GetActorLocation();
        const FIntVector CellCoord(
            FMath::FloorToInt(Position.X / CellSize),
            FMath::FloorToInt(Position.Y / CellSize),
            FMath::FloorToInt(Position.Z / CellSize)
        );
        SpatialGrid.FindOrAdd(CellCoord).Add(Fish);
    }
}
void UTickableWorldSubsystem_FishManager::FindNeighborsInRadius(const AActor_Fish* InFishActor, int32 InRadius, TArray<AActor_Fish*>& OutNeighbors) const
{
    OutNeighbors.Reset();

    if (!IsValid(InFishActor)) return;

    const FVector& FishLocation = InFishActor->GetActorLocation();
    const float RadiusSquared = FMath::Square(InRadius);
    const FIntVector OriginCellCoord(
        FMath::FloorToInt(FishLocation.X / CellSize),
        FMath::FloorToInt(FishLocation.Y / CellSize),
        FMath::FloorToInt(FishLocation.Z / CellSize)
    );

    // Iterate through the 3x3x3 cube of cells around the origin cell
    for (int Z = -1; Z <= 1; ++Z)
    {
        for (int Y = -1; Y <= 1; ++Y)
        {
            for (int X = -1; X <= 1; ++X)
            {
                const FIntVector CellToCheck(OriginCellCoord + FIntVector(X, Y, Z));
                const TArray<AActor_Fish*>* FishesInCell = SpatialGrid.Find(CellToCheck);
                if (!FishesInCell) continue;
               
                for (AActor_Fish* PotentialNeighbor : *FishesInCell)
                {
                    if (PotentialNeighbor == InFishActor) continue;
                    if (FVector::DistSquared(FishLocation, PotentialNeighbor->GetActorLocation()) > RadiusSquared) continue;

                    OutNeighbors.Add(PotentialNeighbor);
                }
            }
        }
    }
}
```
The cell size (1000 units) approximated the neighbor radius, limiting queries to nearby cells (27 in 3D). This reduced average neighbor checks from N to a constant, making the simulation O(N) overall.

In `AActor_Fish::GetNeighbors`, the `GetAllActorsOfClass` was replaced with a manager query:
```cpp {linenos=inline}
void AActor_Fish::GetNeighbors(TArray<AActor_Fish*>& OutNeighbors) const
{
    OutNeighbors.Empty();

    const UWorld* World = GetWorld();
    if (!World) return;

    UTickableWorldSubsystem_FishManager* FishManagerSubsystem = World->GetSubsystem<UTickableWorldSubsystem_FishManager>();
    if (!FishManagerSubsystem) return;

    FishManagerSubsystem->FindNeighborsInRadius(this, NeighborRadius, OutNeighbors);
}
```
Profiling indicated reduced time in neighbor searches, with grid rebuild being O(N) and queries localized.

![Spatial Grid Profile](/posts/1000_boids/step_1_profile_a.png)

![Spatial Grid Profile](/posts/1000_boids/step_1_profile_b.png)

**The Result:** Addressed the O(N²) issue. Performance improved to around 14 FPS max, though actor overhead remained.
![Spatial Grid Result](/posts/1000_boids/step_1.png)

# Step 2: Centralizing Logic & Array of Structs (AoS)
Next, actor overhead was reduced by making `AActor_Fish` handle only targeted states, moving simulation to the `FishManager` with an Array of Structs (AoS).
```cpp {linenos=inline}
USTRUCT()
struct FFishData
{
    GENERATED_BODY()
   
    UPROPERTY(Transient) TObjectPtr<AActor_Fish> Fish = nullptr;
    UPROPERTY(Transient) FVector Position = FVector::ZeroVector;
    UPROPERTY(Transient) FVector Velocity = FVector::ZeroVector;
    UPROPERTY(Transient) int32 FlockGroupID = 0;
    UPROPERTY(Transient) float MaxSpeed = 0.f;
    UPROPERTY(Transient) float MaxForce = 0.f;
    UPROPERTY(Transient) float NeighborRadius = 0.f;
    UPROPERTY(Transient) float SeparationDistance = 0.f;
    UPROPERTY(Transient) float CohesionWeight = 0.f;
    UPROPERTY(Transient) float SeparationWeight = 0.f;
    UPROPERTY(Transient) float AlignmentWeight = 0.f;
    UPROPERTY(Transient) float ContainmentWeight = 0.f;
    UPROPERTY(Transient) float ContainmentCheckDistance = 0.f;
    UPROPERTY(Transient) FVector SpawnAreaCenter = FVector::ZeroVector;
    UPROPERTY(Transient) FVector SpawnAreaBoxExtent = FVector::ZeroVector;
    UPROPERTY(Transient) int32 ID = INDEX_NONE;
};
// In the manager class:
UPROPERTY(Transient) TArray<FFishData> AllFish;
```
`AActor_Fish` disables ticking by default, enabling it only when targeted:
```cpp {linenos=inline}
AActor_Fish::AActor_Fish()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bStartWithTickEnabled = false;
}
void AActor_Fish::ReeledIn(const FVector& RodLocation)
{
    SetActorTickEnabled(true);

    bBeingTargeted = true;
    Velocity = FVector::ZeroVector;
    ReelInLocation = RodLocation;
    LookAtReelInRotation = (RodLocation - GetActorLocation()).Rotation();
    ReeledInTimeline.PlayFromStart();
}
void AActor_Fish::Escape()
{
    SetActorTickEnabled(true);

    ReeledInTimeline.Stop();
    Velocity = FVector::ZeroVector;
    EscapeRotation = (InitialActorLocation - GetActorLocation()).Rotation();
    EscapeTimeline.PlayFromStart();
}
```
The `Tick` in `AActor_Fish` handles only timelines:
```cpp {linenos=inline}
void AActor_Fish::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    TickTimelines(DeltaSeconds);
}
```
The manager's `Tick` simulates data first, then applies to actors.
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::Tick(float DeltaTime)
{
    if (AllFish.Num() == 0) return;

    UpdateSpatialGrid(); // Grid now maps to TArray<int32> (indices into AllFish)

    TArray<FVector> NextVelocities, NextPositions;
    NextVelocities.SetNumUninitialized(AllFish.Num());
    NextPositions.SetNumUninitialized(AllFish.Num());

    // Phase 1: SIMULATE (Single-threaded)
    for (int32 i = 0; i < AllFish.Num(); ++i)
    {
        const FFishData& CurrentFish = AllFish[i];
        if (!IsValid(CurrentFish.Fish) || CurrentFish.Fish->IsBeingTargeted())
        {
            NextVelocities[i] = CurrentFish.Velocity;
            NextPositions[i] = CurrentFish.Position;
            continue;
        }

        TArray<int32> NeighborIndices; // Indices into the AllFish array
        FindNeighborsInRadius(i, CurrentFish.NeighborRadius, NeighborIndices);
       
        const FVector FCohesion = Cohesion(i, NeighborIndices) * CurrentFish.CohesionWeight;
        const FVector FSeparation = Separation(i, NeighborIndices) * CurrentFish.SeparationWeight;
        const FVector FAlignment = Alignment(i, NeighborIndices) * CurrentFish.AlignmentWeight;
        const FVector FBoundary = BoundaryContainment(CurrentFish) * CurrentFish.ContainmentWeight;
        const FVector TotalForce = FCohesion + FSeparation + FAlignment + FBoundary;
       
        FVector NewVelocity = CurrentFish.Velocity + TotalForce * DeltaTime;
        NewVelocity = NewVelocity.GetClampedToMaxSize(CurrentFish.MaxSpeed);
       
        NextVelocities[i] = NewVelocity;
        NextPositions[i] = CurrentFish.Position + NewVelocity * DeltaTime;
    }

    // Phase 2: COMMIT & APPLY
    for (int32 i = 0; i < AllFish.Num(); ++i)
    {
        AllFish[i].Position = NextPositions[i];
        AllFish[i].Velocity = NextVelocities[i];

        if (AActor_Fish* FishActor = AllFish[i].Fish)
        {
             if (!FishActor->IsBeingTargeted())
             {
                 const FRotator NewRotation = AllFish[i].Velocity.ToOrientationRotator();
                 FishActor->SetActorLocationAndRotation(AllFish[i].Position, NewRotation, false, nullptr, ETeleportType::TeleportPhysics);
             }
        }
    }
}
```
The boids rules were adapted to use indices:
```cpp {linenos=inline}
FVector UTickableWorldSubsystem_FishManager::Cohesion(const int32 InFishIndex, const TArray<int32>& InNeighborIndices) const
{
    FVector CenterOfMass = FVector::ZeroVector;
    int32 CohesionCount = 0;
    const int32 CurrentGroupID = AllFish[InFishIndex].FlockGroupID;

    for (const int32 NeighborIndex : InNeighborIndices)
    {
        if (AllFish[NeighborIndex].FlockGroupID != CurrentGroupID) continue;

        CenterOfMass += AllFish[NeighborIndex].Position;
        CohesionCount++;
    }

    if (CohesionCount == 0) return FVector::ZeroVector;

    CenterOfMass /= CohesionCount;
    FVector Desired = CenterOfMass - AllFish[InFishIndex].Position;
    return Steer(AllFish[InFishIndex].Velocity, Desired, AllFish[InFishIndex].MaxForce);
}
```
Similar adaptations for other rules.

Centralizing logic reduced per-actor overhead, as actors avoided flocking calculations unless targeted. AoS kept data contiguous for better cache access.

Profiling showed less time in actor ticking, with the simulation loop as the main focus.

![Centralizing Logic & AoS Profile](/posts/1000_boids/step_2_profile.png)

**The Result:** Improved architecture and reduced overhead, reaching around 22 FPS max.
![Centralizing Logic & AoS Result](/posts/1000_boids/step_2.png)

# Step 3: Going Parallel with Structure of Arrays (SoA)
For parallelism, data was restructured to Structure of Arrays (SoA) for cache efficiency.
```cpp {linenos=inline}
// FROM: TArray<FFishData> AllFish;
// TO: Individual TArrays for each property
UPROPERTY(Transient) TArray<AActor_Fish*> FishActors;
UPROPERTY(Transient) TMap<AActor_Fish*, int32> FishActorToIndexMap;
TMap<FIntVector, TArray<int32>> SpatialGrid;
int32 FishCount = 0;
TArray<FVector> Positions;
TArray<FVector> Velocities;
TArray<int32> FlockGroupIDs;
TArray<float> MaxSpeeds;
TArray<float> MaxForces;
TArray<float> NeighborRadii;
TArray<float> SeparationDistances;
TArray<float> CohesionWeights;
TArray<float> SeparationWeights;
TArray<float> AlignmentWeights;
TArray<float> ContainmentWeights;
TArray<float> ContainmentCheckDistances;
TArray<FVector> SpawnAreaCenters;
TArray<FVector> SpawnAreaBoxExtents;
```
SoA enhances locality, as accessing one property loads contiguous data.

{{< threejs id="memory-race-viz" scene="memory-layout" >}}

Registration maps actors to array indices:
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::RegisterFish(AActor_Fish* InFishActor)
{
    if (!IsValid(InFishActor) || FishActorToIndexMap.Contains(InFishActor)) return;
    const int32 NewIndex = FishCount++;

    FishActors.Add(InFishActor);
    Positions.Add(InFishActor->GetActorLocation());
    Velocities.Add(InFishActor->GetActorForwardVector() * InFishActor->GetMaxSpeed() * 0.5f);
    FlockGroupIDs.Add(InFishActor->GetFlockGroupID());
    MaxSpeeds.Add(InFishActor->GetMaxSpeed());
    MaxForces.Add(InFishActor->GetMaxForce());
    NeighborRadii.Add(InFishActor->GetNeighborRadius());
    SeparationDistances.Add(InFishActor->GetSeparationDistance());
    CohesionWeights.Add(InFishActor->GetCohesionWeight());
    SeparationWeights.Add(InFishActor->GetSeparationWeight());
    AlignmentWeights.Add(InFishActor->GetAlignmentWeight());
    ContainmentWeights.Add(InFishActor->GetContainmentWeight());
    ContainmentCheckDistances.Add(InFishActor->GetContainmentCheckDistance());
    SpawnAreaCenters.Add(InFishActor->GetContainingSpawnAreaCenter());
    SpawnAreaBoxExtents.Add(InFishActor->GetContainingSpawnAreaBoxExtent());
    FishActorToIndexMap.Add(InFishActor, NewIndex);
}
```
### Thread Safety with `ParallelFor`
`ParallelFor` requires separating reads and writes to avoid races. The loop reads from current arrays and writes to separate next arrays. Updates are committed serially.
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::Tick(float DeltaTime)
{
    if (FishCount == 0) return;

    UpdateSpatialGrid();
   
    TArray<FVector> NextVelocities, NextPositions;
    NextVelocities.SetNumUninitialized(FishCount);
    NextPositions.SetNumUninitialized(FishCount);

    // Phase 1: PARALLEL SIMULATION
    ParallelFor(FishCount, [&](int32 i)
    {
        if (!IsValid(FishActors[i]) || FishActors[i]->IsBeingTargeted())
        {
            NextVelocities[i] = Velocities[i];
            NextPositions[i] = Positions[i];
            return;
        }
       
        TArray<int32> NeighborIndices;
        FindNeighborsInRadius(i, NeighborRadii[i], NeighborIndices);
        const FVector FCohesion = Cohesion(i, NeighborIndices) * CohesionWeights[i];
        const FVector FSeparation = Separation(i, NeighborIndices) * SeparationWeights[i];
        const FVector FAlignment = Alignment(i, NeighborIndices) * AlignmentWeights[i];
        const FVector FBoundary = BoundaryContainment(i) * ContainmentWeights[i];
        const FVector TotalForce = FCohesion + FSeparation + FAlignment + FBoundary;
       
        FVector NewVelocity = Velocities[i] + TotalForce * DeltaTime;
        NewVelocity = NewVelocity.GetClampedToMaxSize(MaxSpeeds[i]);
       
        NextVelocities[i] = NewVelocity;
        NextPositions[i] = Positions[i] + NewVelocity * DeltaTime;
    });

    // Phase 2: SERIAL COMMIT (main thread only)
    Positions = MoveTemp(NextPositions);
    Velocities = MoveTemp(NextVelocities);
   
    // Phase 3: SERIAL ACTOR UPDATE (main thread only)
    for (int32 i = 0; i < FishCount; ++i)
    {
        AActor_Fish* FishActor = FishActors[i];
        if (FishActor && !FishActor->IsBeingTargeted())
        {
            const FRotator NewRotation = Velocities[i].ToOrientationRotator();
            FishActor->SetActorLocationAndRotation(Positions[i], NewRotation, false, nullptr, ETeleportType::TeleportPhysics);
        }
    }
}
```
Rules access SoA directly for cache benefits.

{{< threejs id="parallel-viz" scene="parallelization" >}}

Profiling confirmed better multi-core use, reducing frame time.
![SoA & Parallelization Profile](/posts/1000_boids/step_3_profile_a.png)
![SoA & Parallelization Profile](/posts/1000_boids/step_3_profile_b.png)


**The Result:** Multi-core utilization improved performance to around 25 FPS max.
![SoA & Parallelization Result](/posts/1000_boids/step_3.png)

A jump from 22 to 25 FPS might seem modest for a 16-core CPU. This is likely a sign of bottleneck shifting: the CPU work was now efficient enough to reveal that the true bottleneck lay elsewhere. 

The overall frame rate was being limited by the GPU, which still had to process 1,000 individual draw calls. This confirmed that the next and most critical optimization had to be on the rendering side.

# Step 4: ISM Rendering
The CPU was efficient, but GPU draw calls for 1000 actors were a bottleneck. `UInstancedStaticMeshComponent` (ISM) addressed this. By default, no `AActor_Fish` are spawned.

{{< threejs id="ism-rendering-viz" scene="ism-rendering" >}}

`Actor_FishSpawnArea` provides assets and data to the `FishManager` without spawning actors.
```cpp {linenos=inline}
void AActor_FishSpawnArea::OnFishSpawnAssetLoaded()
{
    UObject* LoadedAsset = FishSpawnAssetHandle.Get()->GetLoadedAsset();
    UClass* LoadedAssetAsClass = Cast<UClass>(LoadedAsset);
    if (!SpawnAreaBox)
    {
        UE_LOG(LogFishingFeature, Error, TEXT("Spawn Area Box is not valid, this should not happen. Won't continue spawning fish..."));
        return;
    }

    if (!FishSpawnAreaConfigData)
    {
        UE_LOG(LogFishingFeature, Error, TEXT("Fish Spawn Area Config Data is not set, are you sure you have a valid data asset set? Won't continue spawning fish..."));
        return;
    }

    const FFishSpawnAreaConfig FishSpawnAreaConfig = FishSpawnAreaConfigData->GetFishSpawnAreaConfig();
    
    // We get the visual assets from the default object (CDO) of the Fish class
    AActor_Fish* FishCDO = LoadedFishClass->GetDefaultObject<AActor_Fish>();
    UStaticMeshComponent* MeshComponentCDO = FishCDO->FindComponentByClass<UStaticMeshComponent>();
    if (!MeshComponentCDO || !MeshComponentCDO->GetStaticMesh()) return;
   
    UStaticMesh* FishMesh = MeshComponentCDO->GetStaticMesh();
    UMaterialInterface* FishMaterial = MeshComponentCDO->GetMaterial(0);

    // Give the manager the assets it needs to set up its ISM component
    FishManager->SetFishAssets(LoadedFishClass, FishMesh, FishMaterial);

    // Get spawn parameters from our config data asset
    const FFishSpawnAreaConfig FishSpawnAreaConfig = FishSpawnAreaConfigData->GetFishSpawnAreaConfig();
    const int32 FishSpawnAmount = FishSpawnAreaConfig.FishSpawnAmount;
   
    const int32 NumFlockGroups = FMath::Max(1, FishSpawnAreaConfig.NumberOfFlockGroups);
    TArray<int32> GroupIDsToAssign;
    GroupIDsToAssign.Reserve(FishSpawnAmount);
   
    const int32 BaseSize = FishSpawnAmount / NumFlockGroups;
    int32 Remainder = FishSpawnAmount % NumFlockGroups;
   
    for (int32 GroupIndex = 0; GroupIndex < NumFlockGroups; ++GroupIndex)
    {
        int32 CurrentGroupSize = BaseSize + (Remainder > 0 ? 1 : 0);
       
        for (int32 i = 0; i < CurrentGroupSize; ++i)
        {
            GroupIDsToAssign.Add(GroupIndex);
        }
        if (Remainder <= 0) continue;
        Remainder--;
    }

    if (GroupIDsToAssign.Num() == FishSpawnAmount)
    {
        const int32 LastIndex = GroupIDsToAssign.Num() - 1;
        for (int32 i = 0; i <= LastIndex; ++i)
        {
            const int32 RandIndex = FMath::RandRange(i, LastIndex);
            GroupIDsToAssign.Swap(i, RandIndex);
        }
    }

    // Now, instead of spawning actors, we just add pure data to the manager
    const UDataAsset_ActorFishConfig* ActorFishConfigData = FishCDO->GetActorFishConfigData();
    if (ActorFishConfigData)
    {
        const FActorFishConfig FishConfig = ActorFishConfigData->GetActorFishConfig();

        FVector Min, Max;
        MeshComponentCDO->GetLocalBounds(Min, Max);
        const float FishLength = (Max - Min).GetMax();

        for (int32 i = 0; i < FishSpawnAmount; ++i)
        {
            const FVector RandomLocation = UKismetMathLibrary::RandomPointInBoundingBox(CenterLocation, BoxExtent);
            const int32 GroupID = (i < GroupIDsToAssign.Num()) ? GroupIDsToAssign[i] : 0;

            FishManager->AddFishData(RandomLocation, GroupID, FishConfig, CenterLocation, BoxExtent, FishSpawnAmount, FishLength);
        }
    }
}
```
In `FishManager`, `SetFishAssets` sets up the component, and `AddFishData` populates arrays and instances.
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::OnWorldBeginPlay(UWorld& InWorld)
{
    Super::OnWorldBeginPlay(InWorld);

    // We need an actor in the world to own our component
    ISMOwner = InWorld.SpawnActor<AActor>();
    bIsInitialized = true;
}
void UTickableWorldSubsystem_FishManager::SetFishAssets(TSubclassOf<AActor_Fish> InFishClass, UStaticMesh* InMesh, UMaterialInterface* InMaterial)
{
    if (!bIsInitialized || !ISMOwner || FishISMComponent) return;

    FishActorClass = InFishClass; // Store the class we'll need to spawn for promotion
    FishISMComponent = NewObject<UInstancedStaticMeshComponent>(ISMOwner);
    FishISMComponent->RegisterComponent();
    FishISMComponent->SetStaticMesh(InMesh);

    if (InMaterial) FishISMComponent->SetMaterial(0, InMaterial);
    FishISMComponent->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    ISMOwner->AddInstanceComponent(FishISMComponent);
}
void UTickableWorldSubsystem_FishManager::AddFishData(const FVector& InPosition, int32 InFlockGroupID, const FActorFishConfig& FishConfig, const FVector& InSpawnCenter, const FVector& InSpawnExtent, int32 TotalFishInSim, float FishLength)
{
    if (!FishISMComponent) return;
   
    // OPTIMIZATION: Add to the initial buffer [0] for our double-buffered arrays
    Positions[0].Add(InPosition);
    Velocities[0].Add(FMath::VRand().GetSafeNormal() * FishConfig.MaxSpeed * 0.5f);
   
    FlockGroupIDs.Add(InFlockGroupID);
    MaxSpeeds.Add(FishConfig.MaxSpeed);
    MaxForces.Add(FishConfig.MaxForce);
   
    NeighborRadii.Add(FishConfig.NeighborRadius);
    SeparationDistances.Add(FishConfig.SeparationDistance);
   
    CohesionWeights.Add(FishConfig.CohesionWeight);
    SeparationWeights.Add(FishConfig.SeparationWeight);
    AlignmentWeights.Add(FishConfig.AlignmentWeight);
    ContainmentWeights.Add(FishConfig.ContainmentWeight);
   
    ContainmentCheckDistances.Add(FishConfig.ContainmentCheckDistance);
   
    SpawnAreaCenters.Add(InSpawnCenter);
    SpawnAreaBoxExtents.Add(InSpawnExtent);

    // BEHAVIOR: Add data for wandering
    WanderVectors.Add(FMath::VRand());

    WanderStrengths.Add(1.5f);
    WanderJitters.Add(10.0f);

    // OPTIMIZATION: Keep track of the largest neighbor radius to set an optimal grid cell size
    MaxNeighborRadius = FMath::Max(MaxNeighborRadius, FishConfig.NeighborRadius);
    SpatialGridCellSize = MaxNeighborRadius > 0.f ? MaxNeighborRadius : 1000.f;
    IsBoidPromoted.Add(false);

    // Add a visual instance for this new fish at its starting location
    const FTransform InitialTransform(InPosition);
    FishISMComponent->AddInstance(InitialTransform);
    FishCount++;
}
```
The `Tick` updates ISM transforms in batch:
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::Tick(float DeltaTime)
{
    // ... simulation code ...
    TArray<FTransform> CurrentTransforms;
    CurrentTransforms.Reserve(FishCount);
    for (int32 i = 0; i < FishCount; ++i)
    {
        if (IsBoidPromoted[i]) continue; // Skip promoted ones, as they are actors
        CurrentTransforms.Add(FTransform(Velocities[i].ToOrientationRotator(), Positions[i]));
    }

    if (CurrentTransforms.Num() > 0)
        FishISMComponent->BatchUpdateInstancesTransforms(0, CurrentTransforms, true, true);
}
```
The promote/demote pattern handles interactions by swapping instances for actors.

When finding nearest, query index and promote:
```cpp {linenos=inline}
bool UTickableWorldSubsystem_FishManager::FindNearestBoid(const FVector& Location, float Radius, int32& OutBoidIndex)
{
    OutBoidIndex = INDEX_NONE;
    float MinDistSquared = FMath::Square(Radius);
    for (int32 i = 0; i < FishCount; ++i)
    {
        if (IsBoidPromoted[i]) continue;

        float DistSquared = FVector::DistSquared(Location, Positions[i]);
        if (DistSquared < MinDistSquared)
        {
            MinDistSquared = DistSquared;
            OutBoidIndex = i;
        }
    }

    return OutBoidIndex != INDEX_NONE;
}
AActor_Fish* UTickableWorldSubsystem_FishManager::PromoteBoidToActor(int32 BoidIndex)
{
    if (BoidIndex < 0 || BoidIndex >= FishCount || IsBoidPromoted[BoidIndex] || !FishActorClass) return nullptr;

    UWorld* World = GetWorld();
    if (!World) return nullptr;

    FActorSpawnParameters SpawnParams;
    SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    AActor_Fish* NewFishActor = World->SpawnActor<AActor_Fish>(FishActorClass, Positions[BoidIndex], Velocities[BoidIndex].ToOrientationRotator(), SpawnParams);

    if (!NewFishActor) return nullptr;

    // Sync state from boid to actor
    NewFishActor->SetSpawnAreaCenterAndExtent(SpawnAreaCenters[BoidIndex], SpawnAreaBoxExtents[BoidIndex]);
    NewFishActor->SetFlockGroupID(FlockGroupIDs[BoidIndex]);
    NewFishActor->SetTotalFishInSimulation(FishCount);
    NewFishActor->SetBoidIndex(BoidIndex, this); // So actor knows its origin

    // Hide the instance
    FTransform HiddenTransform = FTransform::Identity;
    HiddenTransform.SetScale3D(FVector::ZeroVector);
    FishISMComponent->UpdateInstanceTransform(BoidIndex, HiddenTransform, false, true);
    IsBoidPromoted[BoidIndex] = true;
    PromotedFishActors.Add(BoidIndex, NewFishActor);
    ActorToBoidIndexMap.Add(NewFishActor, BoidIndex);

    return NewFishActor;
}
```
Demotion hides the actor and restores the instance.
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::DemoteActorToBoid(int32 BoidIndex)
{
    TObjectPtr<AActor_Fish>* ActorPtr = PromotedFishActors.Find(BoidIndex);
    if (!ActorPtr || !*ActorPtr) return;

    AActor_Fish* FishActor = *ActorPtr;
    
    // Sync state back if needed
    Positions[BoidIndex] = FishActor->GetActorLocation();
    Velocities[BoidIndex] = FishActor->GetVelocity();

    // Restore the instance
    FTransform RestoreTransform(Velocities[BoidIndex].ToOrientationRotator(), Positions[BoidIndex]);
    FishISMComponent->UpdateInstanceTransform(BoidIndex, RestoreTransform, false, true);

    // Destroy the actor
    FishActor->Destroy();
    IsBoidPromoted[BoidIndex] = false;
    PromotedFishActors.Remove(BoidIndex);
    ActorToBoidIndexMap.Remove(FishActor);
}
```
In `AActor_Fish`, track for demotion:
```cpp {linenos=inline}
void AActor_Fish::SetBoidIndex(int32 InBoidIndex, UTickableWorldSubsystem_FishManager* InManager)
{
    BoidIndex = InBoidIndex;
    ManagerPtr = InManager;
}

void AActor_Fish::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    if (ManagerPtr.IsValid() && BoidIndex != INDEX_NONE)
    {
        ManagerPtr->DemoteActorToBoid(BoidIndex);
    }

    Super::EndPlay(EndPlayReason);
}
```
ISM batches draws, reducing GPU load from 1000 meshes to one. Only promoted fish are actors.

Profiling showed significant GPU time reduction via instancing.
![ISM Rendering Profile](/posts/1000_boids/step_4_profile.png)

**The Result:** Resolved GPU issues. Around 71 FPS max.
![ISM Rendering Result](/posts/1000_boids/step_4.png)

# Step 5: Buffering and Tweaks for Efficiency
The final refinements focused on making the parallel simulation loop more optimized.

1. **Implementing Double Buffering for Parallel Safety**
The previous step used temporary arrays for the next frame's data, which were then moved back into the main arrays using `MoveTemp`. While `MoveTemp` is extremely efficient, a more robust pattern for parallel processing is double buffering.

Instead of creating temporary arrays each frame, two persistent sets of arrays are maintained for positions and velocities. In any given frame, one set acts as the immutable read buffer, while the other serves as the write buffer.

{{< threejs id="double-buffer-viz" scene="double-buffer" >}}

```cpp {linenos=inline} {title="TickableWorldSubsystem_FishManager.h - Final Data Layout"}
// Double-buffering for data that changes each frame.
TArray<FVector> Positions[2];
TArray<FVector> Velocities[2];
int32 CurrentBufferIndex = 0; // 0 is read, 1 is write (or vice-versa)

// Data for wandering behavior
TArray<FVector> WanderVectors;
TArray<float> WanderStrengths;
TArray<float> WanderJitters;

// Dynamically sized spatial grid
float SpatialGridCellSize = 1000.f;
float MaxNeighborRadius = 0.f;

// State tracking for Promote/Demote
TArray<bool> IsBoidPromoted;
UPROPERTY() TMap<int32, TObjectPtr<AActor_Fish>> PromotedFishActors;
UPROPERTY() TMap<TObjectPtr<AActor_Fish>, int32> ActorToBoidIndexMap;

// ... other SoA data remains the same ...
```
This approach has two key advantages:
- Guaranteed Thread Safety: It provides a clean, formal separation of read and write data. The `ParallelFor` loop can safely read from the `ReadIndex` buffer knowing it will not be modified, while concurrently writing results to the `WriteIndex` buffer. This is a safe way to prevent data race when doing parallelism.
- Eliminates Mid-Frame Allocations: Since both buffers are pre-allocated and persist, it guarantees zero memory reallocations during the `Tick` function. This eliminates a potential source of performance hitches, making frame times more stable and predictable.

At the end of the tick, "flipping" the buffers is a virtually zero-cost operation. It's just a single integer assignment.

In `AddFishData`, set cell size dynamically:
```cpp {linenos=inline}
MaxNeighborRadius = FMath::Max(MaxNeighborRadius, FishConfig.NeighborRadius);
SpatialGridCellSize = MaxNeighborRadius > 0.f ? MaxNeighborRadius : 1000.f;
```
This optimizes grid for different radii.

2. **Accumulating Desired Velocities:** Rules return desired velocity, steered once.
```cpp {linenos=inline}
FVector UTickableWorldSubsystem_FishManager::Cohesion(int32 FishIndex, const TArray<int32>& NeighborIndices) const
{
    // ... calculate CenterOfMass ...
    if (CohesionCount == 0) return FVector::ZeroVector;

    CenterOfMass /= CohesionCount;
    return (CenterOfMass - Positions[CurrentBufferIndex][FishIndex]).GetSafeNormal() * MaxSpeeds[FishIndex];
}
```
Accumulate and steer:
```cpp {linenos=inline}
const FVector WeightedTotal =
    (DesiredCohesion * CohesionWeights[i]) +
    (DesiredSeparation * SeparationWeights[i]) +
    (DesiredAlignment * AlignmentWeights[i]) +
    (DesiredBoundary * ContainmentWeights[i]) +
    (DesiredWander * WanderStrengths[i]);
FVector TotalForce = FVector::ZeroVector;
if (!WeightedTotal.IsNearlyZero())
{
    FVector DesiredVelocity = WeightedTotal.GetSafeNormal() * MaxSpeeds[i];
    TotalForce = Steer(CurrentVelocity, DesiredVelocity, MaxForces[i]);
}
```
This minimizes operations.

Added wandering for natural movement:
```cpp {linenos=inline}
WanderVectors[i] += FMath::VRand() * WanderJitters[i] * DeltaTime;
WanderVectors[i].Normalize();
const FVector DesiredWander = WanderVectors[i] * MaxSpeeds[i];
```
Final `Tick`:
```cpp {linenos=inline}
void UTickableWorldSubsystem_FishManager::Tick(float DeltaTime)
{
    if (FishCount == 0 || !FishISMComponent) return;

    const int32 ReadIndex = CurrentBufferIndex;
    const int32 WriteIndex = (CurrentBufferIndex + 1) % 2;

    UpdateSpatialGrid(); // Reads from [ReadIndex]

    Positions[WriteIndex].SetNumUninitialized(FishCount);
    Velocities[WriteIndex].SetNumUninitialized(FishCount);

    ParallelFor(FishCount, [&](int32 i)
    {
        if (IsBoidPromoted[i])
        {
            Velocities[WriteIndex][i] = Velocities[ReadIndex][i];
            Positions[WriteIndex][i] = Positions[ReadIndex][i];
            return;
        }

        const FVector CurrentPosition = Positions[ReadIndex][i];
        const FVector CurrentVelocity = Velocities[ReadIndex][i];
       
        TArray<int32> NeighborIndices;
        FindNeighborsInRadius(i, NeighborRadii[i], NeighborIndices);

        const FVector DesiredCohesion = Cohesion(i, NeighborIndices);
        const FVector DesiredSeparation = Separation(i, NeighborIndices);
        const FVector DesiredAlignment = Alignment(i, NeighborIndices);
        const FVector DesiredBoundary = BoundaryContainment(i);

        WanderVectors[i] += FMath::VRand() * WanderJitters[i] * DeltaTime;
        WanderVectors[i].Normalize();

        const FVector DesiredWander = WanderVectors[i] * MaxSpeeds[i];
        const FVector WeightedTotal =
            (DesiredCohesion * CohesionWeights[i]) + (DesiredSeparation * SeparationWeights[i]) +
            (DesiredAlignment * AlignmentWeights[i]) + (DesiredBoundary * ContainmentWeights[i]) +
            (DesiredWander * WanderStrengths[i]);
        FVector TotalForce = FVector::ZeroVector;
        
        if (!WeightedTotal.IsNearlyZero())
        {
            FVector DesiredVelocity = WeightedTotal.GetSafeNormal() * MaxSpeeds[i];
            TotalForce = Steer(CurrentVelocity, DesiredVelocity, MaxForces[i]);
        }
       
        FVector NewVelocity = CurrentVelocity + TotalForce * DeltaTime;
        Velocities[WriteIndex][i] = NewVelocity.GetClampedToMaxSize(MaxSpeeds[i]);
        Positions[WriteIndex][i] = CurrentPosition + Velocities[WriteIndex][i] * DeltaTime;
    });

    CurrentBufferIndex = WriteIndex; // Flip buffers - zero cost!
   
    TArray<FTransform> CurrentTransforms;
    CurrentTransforms.Reserve(FishCount);
    for (int32 i = 0; i < FishCount; ++i)
    {
        if (IsBoidPromoted[i])
            CurrentTransforms.Add(FTransform(FQuat::Identity, Positions[CurrentBufferIndex][i], FVector::ZeroVector));
        else
            CurrentTransforms.Add(FTransform(Velocities[CurrentBufferIndex][i].ToOrientationRotator(), Positions[CurrentBufferIndex][i]));
    }
   
    if (CurrentTransforms.Num() > 0)
        FishISMComponent->BatchUpdateInstancesTransforms(0, CurrentTransforms, true, true);
}
```

Profiling showed low overhead and stable performance.
![Double-buffer & accumulating desired movement profile](/posts/1000_boids/step_5_profile.png)

**The Result**: Further refinements brought performance to around 74 FPS max.
![Double-buffer & accumulating desired movement result](/posts/1000_boids/step_5.png)

# What's Next? Part 2: Graduating to Mass?
This system aligns with Unreal Engine's Mass Entity Component System. Refactoring to Mass could provide further gains and integration. More on that in a future update, coming soon™ 

# Conclusion
Improving from 6 FPS to over 70 FPS demonstrates an optimization approach: start basic, profile, and address bottlenecks systematically, shifting from object-oriented to adhere more to data-oriented design principles.

| Step | Technique | Key Idea |
| :-------- | :--------------------------- | :------------------------------------------------------------------ |
| **Start** | Naive Actors | Simple, but O(N²) neighbor search impacted performance. |
| **1** | Spatial Grid | Replaced full searches with localized lookups. |
| **2** | AoS & Centralization | Moved logic to manager, reduced actor ticking. |
| **3** | SoA & Parallelization | Restructured data for multi-core use. |
| **4** | **ISM Rendering** | **Major gain.** Used instances for GPU efficiency. |
| **5** | Final Polish | Buffering and tweaks for efficiency. |

For large-scale simulations, this journey from 6 to over 70 FPS demonstrates that data-oriented approaches leveraging engine capabilities are a highly effective strategy.

This has been a deep dive into a complex optimization process. Feedback is always welcome if this kind of detailed, code-heavy breakdown is valuable.

Thank you for reading. Hopefully, this detailed writeup proves useful in your own projects. See you next time!