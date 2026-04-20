# Industry Mapping Analysis

## Summary

Comprehensive comparison between form dropdown values (81) and database industry values (78) revealed formatting differences that required a translation mapping.

## Results

### ✅ Exact Matches: 54 values
These values are identical between form and database - no mapping needed.

### ⚠️ Non-Matches Requiring Mapping: 23 values

Now covered by `INDUSTRY_FORM_TO_DB` mapping in `scripts/create-search-function.js`:

#### Minor Formatting Differences (7)
| Form Value | Database Value | Issue |
|------------|----------------|-------|
| Charity/Non-Profit | Charity/Non-profit | Capitalization |
| Restaurants/Cafes | Restaurants & Cafes | `/` vs `&` |
| Construction Supplier | Construction - Supplier | Missing hyphen |
| Logistics/Trucking | Logistics & Trucking | `/` vs `&` |
| Mining/Quarrying | Mining & Quarrying | `/` vs `&` |
| Ship Building & Repair/Maritime Operations | Ship Building/Repair & Maritime Operations | Slash position |
| E-Commerce | E-commerce | Capitalization |

#### Tech Industries - Suffix → Prefix Format (6)
| Form Value | Database Value |
|------------|----------------|
| Tech - Software/Web Development | Tech - Software & Web Development |
| Video Games | Tech - Video Game |
| Computer/Network Security | Tech - Computer Network Security |
| Tech - Hardware | Tech - Technology Hardware |
| Biotechnology | Tech - Biotechnology |
| Animation | Tech - Animation |

#### Manufacturing Industries - Suffix → Prefix Format (9)
| Form Value | Database Value |
|------------|----------------|
| Apparel/Textiles (Manufacturing) | Manufacturing - Apparel/Textiles |
| Food/Beverage (Manufacturing) | Manufacturing - Food & Beverage |
| Consumer Goods (Manufacturing) | Manufacturing - Consumer Goods |
| Electronic (Manufacturing) | Manufacturing - Electronic |
| Industrial (Manufacturing) | Manufacturing - Industrial |
| Metal (Manufacturing) | Manufacturing - Metal |
| Paper/Print (Manufacturing) | Manufacturing - Paper/Print |
| Plastics (Manufacturing) | Manufacturing - Plastics |
| Wood Products (Manufacturing) | Manufacturing - Wood Products |

#### Wellness (1)
| Form Value | Database Value |
|------------|----------------|
| Wellness - Fitness | Wellness - Fitness/Yoga/Pilates |

### 🔵 In Form But Not In Database: 4 values

These form values have no database equivalent and will not match any grants (expected behavior - they may be new industries not yet in grant data):

1. **Wellness** (generic)
2. **Wellness - Counselling/Therapy**
3. **Wellness - Registered Practitioner**
4. **Technology** (generic - use specific tech subcategories instead)

**Impact**: Users selecting these industries will only see "All Industries" grants, not industry-specific programs.

**Recommendation**: Either:
- Add these industries to grant database, OR
- Update form to remove these options, OR
- Document that these are catch-all categories

### 🟡 In Database But Not In Form: 16 values

These database values exist in grant data but are not selectable in the form:

1. **All Industries** (special filter value - handled separately in SQL)
2. **Manufacturing - [prefix]** variants (9) - Covered by form's suffix format
3. **Tech - [prefix]** variants (5) - Covered by form's suffix format
4. **Wellness - Fitness/Yoga/Pilates** - Covered by form's "Wellness - Fitness"

**Impact**: None - these are alternate formats already covered by the mapping.

## Coverage

- **77 of 81 form values can match database grants** (95%)
- **4 form values have no database equivalent** (5%)
- **23 values require translation** (covered by mapping)
- **54 values match exactly** (no translation needed)

## Implementation

The `INDUSTRY_FORM_TO_DB` mapping in `scripts/create-search-function.js` (lines 219-250) now includes all 23 non-matching values, ensuring proper filtering for:
- 54 exact matches (pass through as-is)
- 23 translated values (mapped to DB format)
- 4 unmapped values (will only show "All Industries" grants)

## SQL Logic

```sql
AND (
  industries ILIKE '%All Industries%'
  OR industries IS NULL
  OR industries = ''
  OR industries ILIKE '%{translated_value}%'
  OR REPLACE(industries, E'Industries\n      ', '') ILIKE '%{translated_value}%'
)
```

This ensures:
1. "All Industries" grants always show
2. Exact match on translated database format
3. Match even if "Industries\n" prefix present (data contamination handling)
